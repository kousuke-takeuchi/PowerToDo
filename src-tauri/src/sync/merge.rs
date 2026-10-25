//! Task-level merge (task-level merge spec section 4): base (the content of the last sync),
//! local and remote are compared and merged. Pure: no files, no clock. `newer` is the side whose
//! file is newer (the `keep` of `Action::Conflict`); it wins a field both sides changed.

use std::collections::{BTreeMap, BTreeSet};

use crate::domain::model::Task;
use crate::store::project_book::ProjectBook;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::model::Priority;
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
}
