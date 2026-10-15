//! Label management and bulk edits that span every project (仕様 §3.3, §3.1). Second `impl`
//! block of [`ProjectStore`]; split out of `project_store.rs` to keep that file readable.

use chrono::NaiveDate;

use super::project_store::{DEFAULT_COLOR, LoadedProject, ProjectStore, invalid, recompute_days};
use crate::domain::{Label, Task};
use crate::error::AppResult;

fn clean_label_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(invalid("ラベル名が空です"));
    }
    if n.contains(['@', ',', '、']) {
        return Err(invalid("ラベル名に @ , 、 は使えません"));
    }
    Ok(n.to_string())
}

fn same_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

impl ProjectStore {
    /// The `order` for a label appended after every sheet label.
    fn next_label_order(&self) -> u32 {
        self.common
            .labels
            .iter()
            .map(|l| l.order + 1)
            .max()
            .unwrap_or(0)
    }

    /// Labels from the common workbook (sheet order) followed by names that only appear on
    /// tasks (name order, default color).
    pub fn labels_union(&self) -> Vec<Label> {
        let mut out = self.labels();
        let mut extra: Vec<String> = self
            .all_tasks()
            .into_iter()
            .flat_map(|t| t.labels)
            .filter(|n| !out.iter().any(|l| &l.name == n))
            .collect();
        extra.sort();
        extra.dedup();
        let base = self.next_label_order();
        for (i, name) in extra.into_iter().enumerate() {
            out.push(Label {
                name,
                color: DEFAULT_COLOR.into(),
                order: base + i as u32,
            });
        }
        out
    }

    pub fn label_by_name(&self, name: &str) -> Label {
        self.labels_union()
            .into_iter()
            .find(|l| l.name == name)
            .unwrap_or_else(|| Label {
                name: name.to_string(),
                color: DEFAULT_COLOR.into(),
                order: self.next_label_order(),
            })
    }

    fn sheet_label_mut(&mut self, name: &str) -> Option<&mut Label> {
        self.common.labels.iter_mut().find(|l| l.name == name)
    }

    /// Adds a sheet row for `name` if it has none (a name that so far only lived on tasks).
    fn ensure_sheet_label(&mut self, name: &str) -> Label {
        if let Some(l) = self.sheet_label_mut(name) {
            return l.clone();
        }
        let label = Label {
            name: name.to_string(),
            color: DEFAULT_COLOR.into(),
            order: self.next_label_order(),
        };
        self.common.labels.push(label.clone());
        self.common_dirty = true;
        label
    }

    pub fn add_label(&mut self, name: &str, color: &str) -> AppResult<Label> {
        let name = clean_label_name(name)?;
        if self
            .labels_union()
            .iter()
            .any(|l| same_name(&l.name, &name))
        {
            return Err(invalid(format!("ラベル「{name}」は既にあります")));
        }
        self.ensure_sheet_label(&name);
        let l = self.sheet_label_mut(&name).expect("just ensured");
        l.color = color.to_string();
        let out = l.clone();
        self.common_dirty = true;
        Ok(out)
    }

    pub fn update_label_color(&mut self, name: &str, color: &str) -> AppResult<Label> {
        let name = clean_label_name(name)?;
        self.ensure_sheet_label(&name);
        let l = self.sheet_label_mut(&name).expect("just ensured");
        l.color = color.to_string();
        let out = l.clone();
        self.common_dirty = true;
        Ok(out)
    }

    /// Applies `f` to every loaded project's tasks; returns the names of the projects where
    /// `f` changed something (they are marked dirty and their working-day counts recomputed).
    /// Failed projects are skipped. Names come back in byte order.
    fn edit_all_projects(&mut self, mut f: impl FnMut(&mut Task) -> bool) -> Vec<String> {
        let holidays = self.common.holidays.clone();
        let mut changed = Vec::new();
        for name in self.loaded_names() {
            let Some(LoadedProject::Ok(book)) = self.books.get_mut(&name) else {
                continue;
            };
            let mut touched = false;
            for t in &mut book.tasks {
                touched |= f(t);
            }
            if touched {
                recompute_days(book, &holidays);
                self.dirty.insert(name.clone());
                changed.push(name);
            }
        }
        changed.sort();
        changed
    }

    pub fn rename_label(&mut self, name: &str, new_name: &str) -> AppResult<(Label, Vec<String>)> {
        let new_name = clean_label_name(new_name)?;
        if new_name != name
            && self
                .labels_union()
                .iter()
                .any(|l| l.name != name && same_name(&l.name, &new_name))
        {
            return Err(invalid(format!("ラベル「{new_name}」は既にあります")));
        }
        if new_name == name {
            return Ok((self.label_by_name(name), Vec::new()));
        }
        self.ensure_sheet_label(name);
        let l = self.sheet_label_mut(name).expect("just ensured");
        l.name = new_name.clone();
        let label = l.clone();
        if let Some(extra) = self.common.label_extra.remove(name) {
            self.common.label_extra.insert(new_name.clone(), extra);
        }
        self.common_dirty = true;
        let changed = self.edit_all_projects(|t| {
            let mut hit = false;
            for l in &mut t.labels {
                if l == name {
                    *l = new_name.clone();
                    hit = true;
                }
            }
            hit
        });
        Ok((label, changed))
    }

    pub fn delete_label(&mut self, name: &str) -> AppResult<Vec<String>> {
        let before = self.common.labels.len();
        self.common.labels.retain(|l| l.name != name);
        self.common.label_extra.remove(name);
        if self.common.labels.len() != before {
            self.common_dirty = true;
        }
        Ok(self.edit_all_projects(|t| {
            let before = t.labels.len();
            t.labels.retain(|l| l != name);
            t.labels.len() != before
        }))
    }

    /// Every unfinished top-level task due before `today` gets `due` (time kept). 仕様 §3.1.
    pub fn reschedule_overdue(
        &mut self,
        today: NaiveDate,
        due: NaiveDate,
    ) -> AppResult<Vec<String>> {
        Ok(self.edit_all_projects(|t| {
            let overdue =
                t.parent_no.is_none() && t.progress < 100 && t.due.is_some_and(|d| d < today);
            if overdue {
                t.due = Some(due);
            }
            overdue
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::super::paths::Paths;
    use super::super::project_store::ProjectStore;
    use crate::domain::dates::business_days;
    use crate::domain::{TaskInput, TaskPatch};
    use crate::store::common_book::read_common_book;
    use chrono::{NaiveDate, NaiveDateTime};

    fn clock() -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, 13)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap()
    }

    fn store() -> (tempfile::TempDir, ProjectStore) {
        let dir = tempfile::tempdir().unwrap();
        let mut s = ProjectStore::open(Paths::new(dir.path()), clock, true).unwrap();
        s.create_project("仕事", "var(--color-success)").unwrap();
        (dir, s)
    }

    fn input(title: &str, labels: &[&str], due: Option<NaiveDate>) -> TaskInput {
        TaskInput {
            title: title.into(),
            section: None,
            priority: None,
            due,
            due_time: None,
            note: None,
            labels: labels.iter().map(|s| s.to_string()).collect(),
            parent_no: None,
            rrule: None,
            reminders: vec![],
        }
    }

    #[test]
    fn labels_union_adds_names_only_used_by_tasks() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_task("受信トレイ", input("a", &["食品", "急ぎ"], None))
            .unwrap();
        let names: Vec<String> = s.labels_union().into_iter().map(|l| l.name).collect();
        assert_eq!(names, vec!["食品", "急ぎ"]);
        assert_eq!(s.label_by_name("急ぎ").color, "var(--color-text-muted)");
    }

    #[test]
    fn rename_label_rewrites_every_project_and_reports_them() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_task("受信トレイ", input("a", &["食品"], None))
            .unwrap();
        s.add_task("仕事", input("b", &["食品", "急ぎ"], None))
            .unwrap();
        s.add_task("仕事", input("c", &["急ぎ"], None)).unwrap();
        s.save("受信トレイ").unwrap();
        s.save("仕事").unwrap();
        let (label, changed) = s.rename_label("食品", "食べ物").unwrap();
        assert_eq!(label.name, "食べ物");
        assert_eq!(changed, vec!["仕事", "受信トレイ"]);
        assert_eq!(s.dirty_projects(), vec!["仕事", "受信トレイ"]);
        let b = &s.view("仕事").unwrap().tasks[0];
        assert_eq!(b.labels, vec!["食べ物", "急ぎ"]);
        assert!(s.labels_union().iter().all(|l| l.name != "食品"));
    }

    #[test]
    fn rename_label_rejects_existing_name() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_label("Food", "var(--color-success)").unwrap();
        assert!(matches!(
            s.rename_label("食品", "food"),
            Err(crate::error::AppError::Invalid { .. })
        ));
        assert!(matches!(
            s.rename_label("食品", " "),
            Err(crate::error::AppError::Invalid { .. })
        ));
        assert!(matches!(
            s.add_label("食品", "x"),
            Err(crate::error::AppError::Invalid { .. })
        ));
    }

    #[test]
    fn delete_label_strips_it_from_tasks() {
        let (_d, mut s) = store();
        s.add_task("仕事", input("b", &["食品", "急ぎ"], None))
            .unwrap();
        s.save("仕事").unwrap();
        let changed = s.delete_label("食品").unwrap();
        assert_eq!(changed, vec!["仕事"]);
        assert_eq!(s.view("仕事").unwrap().tasks[0].labels, vec!["急ぎ"]);
    }

    #[test]
    fn reschedule_overdue_moves_only_overdue_open_top_level_and_keeps_time() {
        let (_d, mut s) = store();
        let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();
        let v = s
            .add_task("受信トレイ", input("old", &[], Some(d(2026, 10, 1))))
            .unwrap();
        let old_no = v.tasks[0].no;
        s.update_task(
            "受信トレイ",
            old_no,
            TaskPatch {
                start: Some(Some(d(2026, 9, 28))),
                ..Default::default()
            },
        )
        .unwrap();
        let v = s
            .add_task("仕事", input("old-timed", &[], Some(d(2026, 10, 5))))
            .unwrap();
        let no = v.tasks[0].no;
        s.update_task(
            "仕事",
            no,
            TaskPatch {
                due_time: Some(Some(chrono::NaiveTime::from_hms_opt(15, 0, 0).unwrap())),
                ..Default::default()
            },
        )
        .unwrap();
        s.add_task("仕事", input("today", &[], Some(d(2026, 10, 13))))
            .unwrap();
        let v = s
            .add_task("仕事", input("done", &[], Some(d(2026, 10, 2))))
            .unwrap();
        let done_no = v.tasks.iter().find(|t| t.title == "done").unwrap().no;
        s.complete_task("仕事", done_no, true).unwrap();
        let mut child = input("child", &[], Some(d(2026, 10, 3)));
        child.parent_no = Some(no);
        s.add_task("仕事", child).unwrap();
        s.save("受信トレイ").unwrap();
        s.save("仕事").unwrap();
        let changed = s
            .reschedule_overdue(d(2026, 10, 13), d(2026, 10, 14))
            .unwrap();
        assert_eq!(changed, vec!["仕事", "受信トレイ"]);
        let tasks = s.all_tasks();
        let by = |title: &str| tasks.iter().find(|t| t.title == title).unwrap();
        let timed = by("old-timed");
        assert_eq!(timed.due, Some(d(2026, 10, 14)));
        assert_eq!(
            timed.due_time.map(|t| t.format("%H:%M").to_string()),
            Some("15:00".into())
        );
        assert_eq!(by("today").due, Some(d(2026, 10, 13)));
        assert_eq!(by("done").due, Some(d(2026, 10, 2)));
        assert_eq!(by("child").due, Some(d(2026, 10, 3)));
        let old = by("old");
        assert_eq!(old.due, Some(d(2026, 10, 14)));
        assert_eq!(
            old.days,
            Some(business_days(d(2026, 9, 28), d(2026, 10, 14), &[]))
        );
    }

    #[test]
    fn reschedule_skips_failed_projects() {
        let (dir, mut s) = store();
        let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();
        s.add_task("受信トレイ", input("old", &[], Some(d(2026, 10, 1))))
            .unwrap();
        s.save("受信トレイ").unwrap();
        std::fs::write(dir.path().join("仕事.xlsx"), b"not an xlsx").unwrap();
        s.reload_discarding("仕事").unwrap_err();
        let changed = s
            .reschedule_overdue(d(2026, 10, 13), d(2026, 10, 14))
            .unwrap();
        assert_eq!(changed, vec!["受信トレイ"]);
    }

    #[test]
    fn rename_and_delete_label_move_extra_columns() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_label("急ぎ", "var(--color-success)").unwrap();
        s.common.label_columns = vec!["説明".to_string()];
        for (name, text) in [("食品", "買い物"), ("急ぎ", "今日中")] {
            s.common.label_extra.insert(
                name.to_string(),
                [("説明".to_string(), text.to_string())].into(),
            );
        }
        s.save_common().unwrap();
        s.rename_label("食品", "食べ物").unwrap();
        s.delete_label("急ぎ").unwrap();
        s.save_common().unwrap();
        let book = read_common_book(&s.paths().common()).unwrap();
        assert_eq!(book.label_extra["食べ物"]["説明"], "買い物");
        assert!(!book.label_extra.contains_key("食品"));
        assert!(!book.label_extra.contains_key("急ぎ"));
        assert!(!s.common.label_extra.contains_key("急ぎ"));
    }

    #[test]
    fn rename_label_to_same_name_is_a_no_op() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_task("仕事", input("a", &["食品"], None)).unwrap();
        s.save("仕事").unwrap();
        s.save_common().unwrap();
        let (label, changed) = s.rename_label("食品", "食品").unwrap();
        assert_eq!(label.name, "食品");
        assert!(changed.is_empty());
        assert!(s.dirty_projects().is_empty());
        assert!(!s.common_dirty());
    }
}
