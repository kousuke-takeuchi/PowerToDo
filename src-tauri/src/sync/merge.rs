//! Task-level merge (task-level merge spec section 4): base (the content of the last sync),
//! local and remote are compared and merged. Pure: no files, no clock. `newer` is the side whose
//! file is newer (the `keep` of `Action::Conflict`); it wins a field both sides changed.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use chrono::NaiveDate;

use crate::domain::model::{Label, Project, Task};
use crate::error::AppResult;
use crate::store::common_book::{
    COMMON_FILE, CommonBook, Settings, read_common_book, write_common_book,
};
use crate::store::project_book::{ProjectBook, read_project_book, write_project_book};
use crate::sync::Side;

/// The change of one side, or the value both changed to, or the newer side's.
pub fn pick<T: PartialEq + Clone>(base: &T, local: &T, remote: &T, newer: Side) -> T {
    if local == remote || remote == base {
        local.clone()
    } else if local == base {
        remote.clone()
    } else {
        match newer {
            Side::Local => local.clone(),
            Side::Remote => remote.clone(),
        }
    }
}

/// Names (sections, assignees, columns) merged as a set: a name added on one side is added, a
/// name removed on one side is removed. Ordered as the newer side, then the other side's own.
pub fn merge_names(
    base: &[String],
    local: &[String],
    remote: &[String],
    newer: Side,
) -> Vec<String> {
    let keep = |n: &String| {
        let (b, l, r) = (base.contains(n), local.contains(n), remote.contains(n));
        (l && r) || (l && !b) || (r && !b)
    };
    let (first, second) = match newer {
        Side::Local => (local, remote),
        Side::Remote => (remote, local),
    };
    let mut out: Vec<String> = Vec::new();
    for n in first.iter().chain(second) {
        if keep(n) && !out.contains(n) {
            out.push(n.clone());
        }
    }
    out
}

/// Cells keyed by column (unknown columns, extra settings): a missing cell is `None`.
fn merge_extra(
    base: &BTreeMap<String, String>,
    local: &BTreeMap<String, String>,
    remote: &BTreeMap<String, String>,
    newer: Side,
) -> BTreeMap<String, String> {
    let keys: BTreeSet<&String> = base
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .collect();
    keys.into_iter()
        .filter_map(|k| {
            pick(&base.get(k), &local.get(k), &remote.get(k), newer).map(|v| (k.clone(), v.clone()))
        })
        .collect()
}

/// One task both sides still have.
fn merge_task(b: &Task, l: &Task, r: &Task, newer: Side) -> Task {
    // Taken together: a task is never done without its completion time, or the other way.
    let (progress, completed_at) = pick(
        &(b.progress, b.completed_at),
        &(l.progress, l.completed_at),
        &(r.progress, r.completed_at),
        newer,
    );
    Task {
        no: l.no,
        project: pick(&b.project, &l.project, &r.project, newer),
        category: pick(&b.category, &l.category, &r.category, newer),
        title: pick(&b.title, &l.title, &r.title, newer),
        assignee: pick(&b.assignee, &l.assignee, &r.assignee, newer),
        priority: pick(&b.priority, &l.priority, &r.priority, newer),
        progress,
        start: pick(&b.start, &l.start, &r.start, newer),
        due: pick(&b.due, &l.due, &r.due, newer),
        due_time: pick(&b.due_time, &l.due_time, &r.due_time, newer),
        days: pick(&b.days, &l.days, &r.days, newer),
        note: pick(&b.note, &l.note, &r.note, newer),
        parent_no: pick(&b.parent_no, &l.parent_no, &r.parent_no, newer),
        labels: pick(&b.labels, &l.labels, &r.labels, newer),
        rrule: pick(&b.rrule, &l.rrule, &r.rrule, newer),
        rrule_label: None,
        reminders: pick(&b.reminders, &l.reminders, &r.reminders, newer),
        order: pick(&b.order, &l.order, &r.order, newer),
        created_at: pick(&b.created_at, &l.created_at, &r.created_at, newer),
        completed_at,
        extra: merge_extra(&b.extra, &l.extra, &r.extra, newer),
    }
}

pub struct ProjectMerge {
    pub book: ProjectBook,
    /// (old No., new No.) of local tasks moved because the remote added a task with that No.
    pub renumbered: Vec<(u32, u32)>,
}

/// Spec 4.1-4.3. The three must have no `invalid_rows` / `invalid_cells` (the caller checks:
/// those rows are never rewritten by the app). `high_water`: the highest No. this PC handed
/// out for the project, so a moved task never gets a number used before.
pub fn merge_project(
    base: &ProjectBook,
    local: &ProjectBook,
    remote: &ProjectBook,
    newer: Side,
    high_water: u32,
) -> ProjectMerge {
    let by_no = |b: &ProjectBook| -> BTreeMap<u32, Task> {
        b.tasks.iter().map(|t| (t.no, t.clone())).collect()
    };
    let (bm, lm, rm) = (by_no(base), by_no(local), by_no(remote));
    let nos: BTreeSet<u32> = bm
        .keys()
        .chain(lm.keys())
        .chain(rm.keys())
        .copied()
        .collect();
    let mut tasks: Vec<Task> = Vec::new();
    let mut moved: Vec<Task> = Vec::new();
    for no in nos {
        match (bm.get(&no), lm.get(&no), rm.get(&no)) {
            (None, Some(l), None) => tasks.push(l.clone()),
            (None, None, Some(r)) => tasks.push(r.clone()),
            (None, Some(l), Some(r)) if l == r => tasks.push(l.clone()),
            (None, Some(l), Some(r)) => {
                tasks.push(r.clone());
                moved.push(l.clone());
            }
            // Deleted on one side, edited on the other: the edit stays.
            (Some(b), None, Some(r)) if r != b => tasks.push(r.clone()),
            (Some(b), Some(l), None) if l != b => tasks.push(l.clone()),
            (Some(b), Some(l), Some(r)) => tasks.push(merge_task(b, l, r, newer)),
            // Deleted on one side and untouched on the other, or deleted on both.
            _ => {}
        }
    }

    let mut next = tasks
        .iter()
        .map(|t| t.no)
        .chain(bm.keys().copied())
        .chain(std::iter::once(high_water))
        .max()
        .unwrap_or(0);
    let remote_kept: BTreeSet<u32> = moved.iter().map(|t| t.no).collect();
    let mut renumbered = Vec::new();
    for mut t in moved {
        next += 1;
        renumbered.push((t.no, next));
        t.no = next;
        tasks.push(t);
    }
    // A local 親No. that points at a moved No. meant the local task: it follows the task.
    let moved_to: BTreeMap<u32, u32> = renumbered.iter().copied().collect();
    let moved_from: BTreeMap<u32, u32> = renumbered.iter().map(|(f, t)| (*t, *f)).collect();
    for t in tasks.iter_mut() {
        let Some(parent) = t.parent_no else {
            continue;
        };
        let Some(&to) = moved_to.get(&parent) else {
            continue;
        };
        if remote_kept.contains(&t.no) {
            continue;
        }
        let local_no = moved_from.get(&t.no).copied().unwrap_or(t.no);
        let from_local = lm
            .get(&local_no)
            .is_some_and(|l| l.parent_no == Some(parent));
        let from_remote = !moved_from.contains_key(&t.no)
            && rm.get(&t.no).is_some_and(|r| r.parent_no == Some(parent));
        if from_local && !from_remote {
            t.parent_no = Some(to);
        }
    }
    tasks.sort_by_key(|t| (t.order, t.no));

    let mut sections = merge_names(&base.sections, &local.sections, &remote.sections, newer);
    // A section a task still uses comes back (spec 4.1: the task is not lost).
    for t in &tasks {
        if let Some(c) = &t.category
            && !sections.contains(c)
        {
            sections.push(c.clone());
        }
    }
    ProjectMerge {
        book: ProjectBook {
            project: pick(&base.project, &local.project, &remote.project, newer),
            sections,
            assignees: merge_names(&base.assignees, &local.assignees, &remote.assignees, newer),
            tasks,
            invalid_rows: Vec::new(),
            unknown_columns: merge_names(
                &base.unknown_columns,
                &local.unknown_columns,
                &remote.unknown_columns,
                newer,
            ),
            invalid_cells: BTreeMap::new(),
        },
        renumbered,
    }
}

/// Rows keyed by name (projects, labels): the table of spec 4.1, `merge_row` for rows both
/// sides kept. Ordered as `merge_names` orders the names.
fn merge_rows<T: PartialEq + Clone>(
    base: &[T],
    local: &[T],
    remote: &[T],
    newer: Side,
    name: impl Fn(&T) -> &str,
    merge_row: impl Fn(&T, &T, &T) -> T,
) -> Vec<T> {
    let find = |v: &[T], n: &str| v.iter().find(|x| name(x) == n).cloned();
    let names = |v: &[T]| v.iter().map(|x| name(x).to_string()).collect::<Vec<_>>();
    let mut all = merge_names(&names(base), &names(local), &names(remote), newer);
    // A row deleted on one side but edited on the other comes back (the edit wins).
    for x in local.iter().chain(remote) {
        let n = name(x);
        if !all.iter().any(|a| a == n) && find(base, n).is_some_and(|b| b != *x) {
            all.push(n.to_string());
        }
    }
    all.into_iter()
        .filter_map(
            |n| match (find(base, &n), find(local, &n), find(remote, &n)) {
                (Some(b), Some(l), Some(r)) => Some(merge_row(&b, &l, &r)),
                (_, Some(l), None) => Some(l),
                (_, None, Some(r)) => Some(r),
                (None, Some(l), Some(r)) => Some(match newer {
                    Side::Local => l,
                    Side::Remote => r,
                }),
                _ => None,
            },
        )
        .collect()
}

fn merge_settings(b: &Settings, l: &Settings, r: &Settings, newer: Side) -> Settings {
    Settings {
        display_name: pick(&b.display_name, &l.display_name, &r.display_name, newer),
        week_start: pick(&b.week_start, &l.week_start, &r.week_start, newer),
        timezone: pick(&b.timezone, &l.timezone, &r.timezone, newer),
        default_reminder: pick(
            &b.default_reminder,
            &l.default_reminder,
            &r.default_reminder,
            newer,
        ),
        notify_time: pick(&b.notify_time, &l.notify_time, &r.notify_time, newer),
        keep_in_tray: pick(&b.keep_in_tray, &l.keep_in_tray, &r.keep_in_tray, newer),
        notifications: pick(&b.notifications, &l.notifications, &r.notifications, newer),
    }
}

/// Keyed pairs (設定 rows this version does not know), in merged key order.
fn merge_pairs(
    base: &[(String, String)],
    local: &[(String, String)],
    remote: &[(String, String)],
    newer: Side,
) -> Vec<(String, String)> {
    let map = |v: &[(String, String)]| v.iter().cloned().collect::<BTreeMap<_, _>>();
    let keys = |v: &[(String, String)]| v.iter().map(|p| p.0.clone()).collect::<Vec<_>>();
    let order = merge_names(&keys(base), &keys(local), &keys(remote), newer);
    let merged = merge_extra(&map(base), &map(local), &map(remote), newer);
    order
        .into_iter()
        .filter_map(|k| merged.get(&k).map(|v| (k.clone(), v.clone())))
        .collect()
}

/// Unknown-column cells per project / label name.
fn merge_extra_by_name(
    base: &BTreeMap<String, BTreeMap<String, String>>,
    local: &BTreeMap<String, BTreeMap<String, String>>,
    remote: &BTreeMap<String, BTreeMap<String, String>>,
    newer: Side,
) -> BTreeMap<String, BTreeMap<String, String>> {
    let empty = BTreeMap::new();
    let names: BTreeSet<&String> = base
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .collect();
    names
        .into_iter()
        .map(|n| {
            let get =
                |m: &BTreeMap<String, BTreeMap<String, String>>| m.get(n).unwrap_or(&empty).clone();
            (
                n.clone(),
                merge_extra(&get(base), &get(local), &get(remote), newer),
            )
        })
        .filter(|(_, v)| !v.is_empty())
        .collect()
}

/// Spec 4.4. The three must have no `unparsed_holidays` (the caller checks).
pub fn merge_common(
    base: &CommonBook,
    local: &CommonBook,
    remote: &CommonBook,
    newer: Side,
) -> CommonBook {
    let mut projects = merge_rows(
        &base.projects,
        &local.projects,
        &remote.projects,
        newer,
        |p: &Project| p.name.as_str(),
        |b, l, r| Project {
            name: l.name.clone(),
            color: pick(&b.color, &l.color, &r.color, newer),
            order: pick(&b.order, &l.order, &r.order, newer),
            favorite: pick(&b.favorite, &l.favorite, &r.favorite, newer),
            inbox: pick(&b.inbox, &l.inbox, &r.inbox, newer),
        },
    );
    // Only one inbox: the newer side's.
    if projects.iter().filter(|p| p.inbox).count() > 1 {
        let newer_book = match newer {
            Side::Local => local,
            Side::Remote => remote,
        };
        let keep = newer_book
            .projects
            .iter()
            .find(|p| p.inbox)
            .map(|p| p.name.clone());
        for p in projects.iter_mut() {
            p.inbox = Some(&p.name) == keep.as_ref();
        }
    }
    let labels = merge_rows(
        &base.labels,
        &local.labels,
        &remote.labels,
        newer,
        |x: &Label| x.name.as_str(),
        |b, l, r| Label {
            name: l.name.clone(),
            color: pick(&b.color, &l.color, &r.color, newer),
            order: pick(&b.order, &l.order, &r.order, newer),
        },
    );
    let days = |v: &[NaiveDate]| v.iter().map(|d| d.to_string()).collect::<Vec<_>>();
    let mut holidays: Vec<NaiveDate> = merge_names(
        &days(&base.holidays),
        &days(&local.holidays),
        &days(&remote.holidays),
        newer,
    )
    .iter()
    .filter_map(|d| d.parse().ok())
    .collect();
    holidays.sort();
    holidays.dedup();
    let by_day = |m: &BTreeMap<NaiveDate, String>| {
        m.iter()
            .map(|(d, n)| (d.to_string(), n.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    let holiday_names = merge_extra(
        &by_day(&base.holiday_names),
        &by_day(&local.holiday_names),
        &by_day(&remote.holiday_names),
        newer,
    )
    .into_iter()
    .filter_map(|(d, n)| d.parse::<NaiveDate>().ok().map(|d| (d, n)))
    .filter(|(d, _)| holidays.contains(d))
    .collect();
    CommonBook {
        projects,
        labels,
        holidays,
        holiday_names,
        unparsed_holidays: Vec::new(),
        settings: merge_settings(&base.settings, &local.settings, &remote.settings, newer),
        extra_settings: merge_pairs(
            &base.extra_settings,
            &local.extra_settings,
            &remote.extra_settings,
            newer,
        ),
        project_columns: merge_names(
            &base.project_columns,
            &local.project_columns,
            &remote.project_columns,
            newer,
        ),
        project_extra: merge_extra_by_name(
            &base.project_extra,
            &local.project_extra,
            &remote.project_extra,
            newer,
        ),
        label_columns: merge_names(
            &base.label_columns,
            &local.label_columns,
            &remote.label_columns,
            newer,
        ),
        label_extra: merge_extra_by_name(
            &base.label_extra,
            &local.label_extra,
            &remote.label_extra,
            newer,
        ),
    }
}

pub struct Merged {
    pub bytes: Vec<u8>,
    /// See [`ProjectMerge::renumbered`]; empty for the common workbook.
    pub renumbered: Vec<(u32, u32)>,
}

/// Merges the three contents of `name` (a project workbook, or the common workbook). `Err`
/// says why it cannot: one does not read, or holds rows the app never rewrites (spec section
/// 5). The caller then makes a conflict copy. `holidays` and `today` are for writing a project
/// workbook, as the store writes it.
#[allow(clippy::too_many_arguments)]
pub fn merge_files(
    name: &str,
    base: &[u8],
    local: &[u8],
    remote: &[u8],
    newer: Side,
    high_water: u32,
    holidays: &[NaiveDate],
    today: NaiveDate,
) -> Result<Merged, String> {
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let put = |tag: &str, bytes: &[u8]| -> Result<PathBuf, String> {
        let p = tmp.path().join(format!("{tag}.xlsx"));
        std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
        Ok(p)
    };
    let paths = [
        put("base", base)?,
        put("local", local)?,
        put("remote", remote)?,
    ];
    let out = tmp.path().join("merged.xlsx");
    let renumbered = if name == COMMON_FILE {
        let [b, l, r] = read3(&paths, read_common_book)?;
        if [&b, &l, &r].iter().any(|c| !c.unparsed_holidays.is_empty()) {
            return Err("祝日に日付でない行があります".into());
        }
        write_common_book(&out, &merge_common(&b, &l, &r, newer)).map_err(|e| e.to_string())?;
        Vec::new()
    } else {
        let [b, l, r] = read3(&paths, read_project_book)?;
        if [&b, &l, &r]
            .iter()
            .any(|x| !x.invalid_rows.is_empty() || !x.invalid_cells.is_empty())
        {
            return Err("要修正の行があります".into());
        }
        let m = merge_project(&b, &l, &r, newer, high_water);
        write_project_book(&out, &m.book, today, holidays).map_err(|e| e.to_string())?;
        m.renumbered
    };
    let bytes = std::fs::read(&out).map_err(|e| e.to_string())?;
    Ok(Merged { bytes, renumbered })
}

fn read3<T>(paths: &[PathBuf; 3], read: impl Fn(&Path) -> AppResult<T>) -> Result<[T; 3], String> {
    let one = |p: &PathBuf| read(p).map_err(|e| e.to_string());
    Ok([one(&paths[0])?, one(&paths[1])?, one(&paths[2])?])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::model::Priority;
    use crate::domain::model::{Label, Project};
    use crate::store::common_book::CommonBook;
    use chrono::NaiveDateTime;

    fn task(no: u32, title: &str) -> Task {
        Task {
            no,
            project: "仕事".into(),
            category: None,
            title: title.into(),
            assignee: String::new(),
            priority: Priority(4),
            progress: 0,
            start: None,
            due: None,
            due_time: None,
            days: None,
            note: None,
            parent_no: None,
            labels: vec![],
            rrule: None,
            rrule_label: None,
            reminders: vec![],
            order: no,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    fn book(tasks: Vec<Task>) -> ProjectBook {
        ProjectBook {
            project: "仕事".into(),
            tasks,
            ..Default::default()
        }
    }

    fn titles(b: &ProjectBook) -> Vec<(u32, String)> {
        b.tasks.iter().map(|t| (t.no, t.title.clone())).collect()
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn pick_takes_the_one_change_or_the_newer() {
        assert_eq!(pick(&1, &1, &2, Side::Local), 2);
        assert_eq!(pick(&1, &3, &1, Side::Remote), 3);
        assert_eq!(pick(&1, &4, &4, Side::Remote), 4);
        assert_eq!(pick(&1, &3, &4, Side::Local), 3);
        assert_eq!(pick(&1, &3, &4, Side::Remote), 4);
    }

    #[test]
    fn names_merge_as_a_set_in_the_newer_order() {
        let b = s(&["A", "B", "C"]);
        // local removed B and added L; remote added R and reordered.
        let got = merge_names(
            &b,
            &s(&["A", "C", "L"]),
            &s(&["C", "A", "B", "R"]),
            Side::Remote,
        );
        assert_eq!(got, s(&["C", "A", "R", "L"]));
    }

    #[test]
    fn adds_on_both_sides_are_kept() {
        let b = book(vec![task(1, "牛乳")]);
        let l = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let r = book(vec![task(1, "牛乳"), task(3, "卵")]);
        let m = merge_project(&b, &l, &r, Side::Remote, 2);
        assert_eq!(
            titles(&m.book),
            [(1, "牛乳".into()), (2, "パン".into()), (3, "卵".into())]
        );
        assert!(m.renumbered.is_empty());
    }

    #[test]
    fn different_tasks_edited_on_each_side() {
        let b = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let l = book(vec![task(1, "牛乳を2本"), task(2, "パン")]);
        let r = book(vec![task(1, "牛乳"), task(2, "食パン")]);
        let m = merge_project(&b, &l, &r, Side::Remote, 2);
        assert_eq!(
            titles(&m.book),
            [(1, "牛乳を2本".into()), (2, "食パン".into())]
        );
    }

    #[test]
    fn same_field_takes_the_newer_other_fields_both() {
        let b = book(vec![task(1, "牛乳")]);
        let mut lt = task(1, "牛乳 (L)");
        lt.note = Some("スーパーで".into());
        let rt = task(1, "牛乳 (R)");
        let m = merge_project(&b, &book(vec![lt]), &book(vec![rt]), Side::Local, 1);
        assert_eq!(m.book.tasks[0].title, "牛乳 (L)");
        assert_eq!(m.book.tasks[0].note.as_deref(), Some("スーパーで"));
        let m2 = merge_project(
            &b,
            &book(vec![task(1, "L")]),
            &book(vec![task(1, "R")]),
            Side::Remote,
            1,
        );
        assert_eq!(m2.book.tasks[0].title, "R");
    }

    #[test]
    fn progress_and_completed_at_go_together() {
        let b = book(vec![task(1, "牛乳")]);
        let mut lt = task(1, "牛乳");
        lt.progress = 100;
        lt.completed_at = Some(NaiveDateTime::default() + chrono::Duration::hours(1));
        let mut rt = task(1, "牛乳");
        rt.progress = 50;
        let m = merge_project(&b, &book(vec![lt.clone()]), &book(vec![rt]), Side::Local, 1);
        assert_eq!(
            (m.book.tasks[0].progress, m.book.tasks[0].completed_at),
            (100, lt.completed_at)
        );
    }

    #[test]
    fn delete_vs_edit_keeps_the_edit() {
        let b = book(vec![task(1, "牛乳")]);
        let m = merge_project(
            &b,
            &book(vec![]),
            &book(vec![task(1, "牛乳を2本")]),
            Side::Local,
            1,
        );
        assert_eq!(titles(&m.book), [(1, "牛乳を2本".into())]);
        let m = merge_project(
            &b,
            &book(vec![task(1, "牛乳を2本")]),
            &book(vec![]),
            Side::Remote,
            1,
        );
        assert_eq!(titles(&m.book), [(1, "牛乳を2本".into())]);
    }

    #[test]
    fn delete_of_an_untouched_task_is_followed() {
        let b = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let m = merge_project(&b, &book(vec![task(2, "パン")]), &b, Side::Remote, 2);
        assert_eq!(titles(&m.book), [(2, "パン".into())]);
    }

    #[test]
    fn colliding_new_numbers_move_the_local_task_and_its_children() {
        let b = book(vec![task(1, "牛乳")]);
        let mut child = task(3, "Lの子");
        child.parent_no = Some(2);
        let l = book(vec![task(1, "牛乳"), task(2, "Lの親"), child]);
        let r = book(vec![task(1, "牛乳"), task(2, "R")]);
        let m = merge_project(&b, &l, &r, Side::Remote, 3);
        let by_title = |t: &str| m.book.tasks.iter().find(|x| x.title == t).unwrap().clone();
        assert_eq!(by_title("R").no, 2);
        assert_eq!(by_title("Lの親").no, 4, "max(merged 3, high_water 3) + 1");
        assert_eq!(by_title("Lの子").no, 3);
        assert_eq!(by_title("Lの子").parent_no, Some(4));
        assert_eq!(m.renumbered, [(2, 4)]);
    }

    #[test]
    fn the_same_new_task_on_both_sides_is_one() {
        let b = book(vec![]);
        let l = book(vec![task(1, "牛乳")]);
        let m = merge_project(&b, &l, &l, Side::Remote, 1);
        assert_eq!(titles(&m.book), [(1, "牛乳".into())]);
        assert!(m.renumbered.is_empty());
    }

    #[test]
    fn category_still_used_comes_back() {
        let mut b = book(vec![task(1, "牛乳")]);
        b.sections = s(&["買い物"]);
        let mut l = b.clone();
        l.sections = vec![];
        let mut r = b.clone();
        r.tasks[0].category = Some("買い物".into());
        let m = merge_project(&b, &l, &r, Side::Local, 1);
        assert_eq!(m.book.sections, s(&["買い物"]));
    }

    #[test]
    fn rows_are_in_order_then_no() {
        let b = book(vec![]);
        let mut x = task(1, "x");
        x.order = 5;
        let mut y = task(2, "y");
        y.order = 1;
        let m = merge_project(&b, &book(vec![x]), &book(vec![y]), Side::Remote, 2);
        assert_eq!(titles(&m.book), [(2, "y".into()), (1, "x".into())]);
    }

    fn project(name: &str, inbox: bool) -> Project {
        Project {
            name: name.into(),
            color: "var(--color-text-muted)".into(),
            order: 0,
            favorite: false,
            inbox,
        }
    }

    fn common(projects: Vec<Project>) -> CommonBook {
        CommonBook {
            projects,
            ..CommonBook::new_default()
        }
    }

    fn names_of(c: &CommonBook) -> Vec<String> {
        c.projects.iter().map(|p| p.name.clone()).collect()
    }

    #[test]
    fn projects_added_on_both_sides_are_kept() {
        let b = common(vec![project("受信トレイ", true)]);
        let l = common(vec![project("受信トレイ", true), project("仕事", false)]);
        let r = common(vec![project("受信トレイ", true), project("家", false)]);
        let m = merge_common(&b, &l, &r, Side::Remote);
        assert_eq!(names_of(&m), s(&["受信トレイ", "家", "仕事"]));
    }

    #[test]
    fn project_fields_merge_one_by_one() {
        let b = common(vec![project("仕事", false)]);
        let mut lp = project("仕事", false);
        lp.favorite = true;
        let mut rp = project("仕事", false);
        rp.color = "red".into();
        let m = merge_common(&b, &common(vec![lp]), &common(vec![rp]), Side::Local);
        assert!(m.projects[0].favorite);
        assert_eq!(m.projects[0].color, "red");
    }

    #[test]
    fn one_inbox_after_merge() {
        let b = common(vec![project("受信トレイ", true), project("仕事", false)]);
        let l = common(vec![project("受信トレイ", false), project("仕事", true)]);
        let r = common(vec![
            project("受信トレイ", false),
            project("仕事", false),
            project("家", true),
        ]);
        let m = merge_common(&b, &l, &r, Side::Remote);
        let inboxes: Vec<&str> = m
            .projects
            .iter()
            .filter(|p| p.inbox)
            .map(|p| p.name.as_str())
            .collect();
        assert_eq!(inboxes, ["家"], "the newer side's inbox");
    }

    #[test]
    fn labels_holidays_and_settings() {
        let mut b = CommonBook::new_default();
        b.labels = vec![Label {
            name: "急ぎ".into(),
            color: "red".into(),
            order: 0,
        }];
        let mut l = b.clone();
        l.labels.push(Label {
            name: "家".into(),
            color: "blue".into(),
            order: 1,
        });
        l.holidays = vec![chrono::NaiveDate::from_ymd_opt(2026, 11, 3).unwrap()];
        l.settings.display_name = "たろう".into();
        let mut r = b.clone();
        r.settings.keep_in_tray = !b.settings.keep_in_tray;
        let m = merge_common(&b, &l, &r, Side::Remote);
        let labels: Vec<&str> = m.labels.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(labels, ["急ぎ", "家"]);
        assert_eq!(m.holidays, l.holidays);
        assert_eq!(m.settings.display_name, "たろう");
        assert_eq!(m.settings.keep_in_tray, r.settings.keep_in_tray);
    }

    use crate::store::project_book::{HEADERS, TASK_SHEET};

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()
    }

    fn xlsx(b: &ProjectBook) -> Vec<u8> {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("仕事.xlsx");
        write_project_book(&p, b, today(), &[]).unwrap();
        std::fs::read(&p).unwrap()
    }

    fn read(bytes: &[u8]) -> ProjectBook {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("仕事.xlsx");
        std::fs::write(&p, bytes).unwrap();
        read_project_book(&p).unwrap()
    }

    /// A workbook whose task 1 has text (来週) in the 終了 date column.
    fn with_invalid_row() -> Vec<u8> {
        let mut wb = rust_xlsxwriter::Workbook::new();
        let ws = wb.add_worksheet();
        ws.set_name(TASK_SHEET).unwrap();
        for (c, h) in HEADERS.iter().enumerate() {
            ws.write_string(0, c as u16, *h).unwrap();
        }
        ws.write_number(1, 0, 1.0).unwrap();
        ws.write_string(1, 3, "牛乳").unwrap();
        ws.write_string(1, 8, "来週").unwrap();
        wb.save_to_buffer().unwrap()
    }

    #[test]
    fn merges_project_files() {
        let b = book(vec![task(1, "牛乳")]);
        let l = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let r = book(vec![task(1, "牛乳"), task(3, "卵")]);
        let m = merge_files(
            "仕事.xlsx",
            &xlsx(&b),
            &xlsx(&l),
            &xlsx(&r),
            Side::Remote,
            2,
            &[],
            today(),
        )
        .unwrap();
        let got: Vec<String> = read(&m.bytes).tasks.into_iter().map(|t| t.title).collect();
        assert_eq!(got, ["牛乳", "パン", "卵"]);
    }

    #[test]
    fn unreadable_or_invalid_rows_do_not_merge() {
        let b = xlsx(&book(vec![task(1, "牛乳")]));
        let m = |l: &[u8]| merge_files("仕事.xlsx", &b, l, &b, Side::Remote, 1, &[], today());
        assert!(m(b"not xlsx").is_err());
        let bad = with_invalid_row();
        assert_eq!(read(&bad).invalid_rows.len(), 1);
        assert!(m(&bad).is_err());
    }

    #[test]
    fn merges_the_common_file() {
        let tmp = tempfile::tempdir().unwrap();
        let bytes = |c: &CommonBook| {
            let p = tmp.path().join("_PowerToDo.xlsx");
            crate::store::common_book::write_common_book(&p, c).unwrap();
            std::fs::read(&p).unwrap()
        };
        let b = common(vec![project("受信トレイ", true)]);
        let l = common(vec![project("受信トレイ", true), project("仕事", false)]);
        let r = common(vec![project("受信トレイ", true), project("家", false)]);
        let m = merge_files(
            "_PowerToDo.xlsx",
            &bytes(&b),
            &bytes(&l),
            &bytes(&r),
            Side::Remote,
            0,
            &[],
            today(),
        )
        .unwrap();
        let p = tmp.path().join("out.xlsx");
        std::fs::write(&p, &m.bytes).unwrap();
        let got = crate::store::common_book::read_common_book(&p).unwrap();
        assert_eq!(names_of(&got), s(&["受信トレイ", "家", "仕事"]));
    }
}
