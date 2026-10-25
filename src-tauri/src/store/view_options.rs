//! Spec ⑤ §6: the 「表示」 settings of each screen, as `表示:<screen>` rows of the common book's
//! 設定 sheet (`CommonBook::extra_settings`, which already round-trips and syncs per key).

use std::collections::BTreeMap;

use super::project_store::{LoadedProject, ProjectStore, invalid};
use crate::error::AppResult;

pub const PREFIX: &str = "表示:";
pub const PROJECT: &str = "表示:プロジェクト:";
pub const LABEL: &str = "表示:ラベル:";

impl ProjectStore {
    pub fn view_options(&self) -> BTreeMap<String, String> {
        self.common
            .extra_settings
            .iter()
            .filter(|(k, _)| k.starts_with(PREFIX))
            .cloned()
            .collect()
    }

    /// An empty value removes the row.
    pub fn set_view_option(&mut self, key: &str, value: &str) -> AppResult<()> {
        if !key.starts_with(PREFIX) {
            return Err(invalid(format!("表示の設定のキーではありません: {key}")));
        }
        let rows = &mut self.common.extra_settings;
        match (rows.iter().position(|(k, _)| k == key), value.is_empty()) {
            (Some(i), true) => {
                rows.remove(i);
            }
            (Some(i), false) => rows[i].1 = value.to_string(),
            (None, false) => rows.push((key.to_string(), value.to_string())),
            (None, true) => return Ok(()),
        }
        self.common_dirty = true;
        Ok(())
    }

    /// Moves `<prefix><from>` to `<prefix><to>` (rename), or drops it (`to` = None). On a
    /// rename any row already at the new key is dropped first, even when there is no row at
    /// the old key, so a renamed project or label never inherits a stale row.
    pub(crate) fn follow_view_option(&mut self, prefix: &str, from: &str, to: Option<&str>) {
        let old = format!("{prefix}{from}");
        let new = to.map(|t| format!("{prefix}{t}"));
        let rows = &mut self.common.extra_settings;
        let before = rows.len();
        if let Some(new) = &new {
            rows.retain(|(k, _)| k != new);
        }
        let mut changed = rows.len() != before;
        if let Some(i) = rows.iter().position(|(k, _)| *k == old) {
            match new {
                Some(new) => rows[i].0 = new,
                None => {
                    rows.remove(i);
                }
            }
            changed = true;
        }
        if changed {
            self.common_dirty = true;
        }
    }

    /// Drops `表示:プロジェクト:<n>` rows whose project is not listed and `表示:ラベル:<n>` rows
    /// whose label is not in use (`labels_union`, exact names as the label code compares them).
    /// Such orphans appear when a sync merges another device's write to a name renamed here.
    /// Label rows are pruned only when `prune_labels` is set (at open, after every book is
    /// loaded): after `reload_common` in a sync the project books have not arrived yet, so a
    /// label another device just put on a task would look unused. They are also kept while any
    /// project failed to load, since its tasks' labels are unknown. Marks the common book dirty
    /// only when something was dropped.
    pub(crate) fn prune_view_options(&mut self, prune_labels: bool) {
        let labels: Option<Vec<String>> = (prune_labels
            && self
                .books
                .values()
                .all(|b| matches!(b, LoadedProject::Ok(_))))
        .then(|| self.labels_union().into_iter().map(|l| l.name).collect());
        let projects = &self.common.projects;
        let rows = &mut self.common.extra_settings;
        let before = rows.len();
        rows.retain(|(k, _)| {
            if let Some(n) = k.strip_prefix(PROJECT) {
                projects.iter().any(|p| p.name == n)
            } else if let (Some(n), Some(labels)) = (k.strip_prefix(LABEL), &labels) {
                labels.iter().any(|l| l == n)
            } else {
                true
            }
        });
        if rows.len() != before {
            self.common_dirty = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use chrono::NaiveDateTime;

    use super::*;
    use crate::store::paths::Paths;

    struct Env {
        dir: tempfile::TempDir,
        store: ProjectStore,
    }

    fn clock() -> NaiveDateTime {
        NaiveDateTime::parse_from_str("2026-10-14T09:30", "%Y-%m-%dT%H:%M").unwrap()
    }

    fn open_at(dir: &std::path::Path) -> ProjectStore {
        let c = Arc::new(Mutex::new(clock()));
        ProjectStore::open(Paths::new(dir), move || *c.lock().unwrap(), true).unwrap()
    }

    fn env() -> Env {
        let dir = tempfile::tempdir().unwrap();
        let store = open_at(&dir.path().join("data"));
        Env { dir, store }
    }

    impl Env {
        fn reopen(&self) -> ProjectStore {
            open_at(&self.dir.path().join("data"))
        }
    }

    #[test]
    fn view_option_rows_are_set_replaced_and_removed() {
        let mut e = env();
        e.store
            .set_view_option("表示:今日", "sort=priority")
            .unwrap();
        e.store.set_view_option("表示:今日", "sort=name").unwrap();
        assert_eq!(e.store.view_options()["表示:今日"], "sort=name");
        e.store.set_view_option("表示:今日", "").unwrap();
        assert!(e.store.view_options().is_empty());
        assert!(e.store.set_view_option("表示名", "x").is_err());
    }

    #[test]
    fn view_option_rows_survive_a_save_and_reopen() {
        let mut e = env();
        e.store.set_view_option("表示:近日", "prio=1").unwrap();
        e.store.save_common().unwrap();
        assert_eq!(e.reopen().view_options()["表示:近日"], "prio=1");
    }

    #[test]
    fn view_option_rows_follow_project_and_label_renames_and_deletes() {
        let mut e = env();
        e.store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        e.store
            .set_view_option("表示:プロジェクト:仕事", "group=label")
            .unwrap();
        e.store.rename_project("仕事", "業務").unwrap();
        let v = e.store.view_options();
        assert!(!v.contains_key("表示:プロジェクト:仕事"));
        assert_eq!(v["表示:プロジェクト:業務"], "group=label");
        e.store.delete_project("業務").unwrap();
        assert!(e.store.view_options().is_empty());

        e.store
            .add_label("急ぎ", "var(--color-text-muted)")
            .unwrap();
        e.store
            .set_view_option("表示:ラベル:急ぎ", "sort=date")
            .unwrap();
        e.store.rename_label("急ぎ", "至急").unwrap();
        assert_eq!(e.store.view_options()["表示:ラベル:至急"], "sort=date");
        e.store.delete_label("至急").unwrap();
        assert!(e.store.view_options().is_empty());
    }

    fn task(title: &str, labels: &[&str]) -> crate::domain::TaskInput {
        crate::domain::TaskInput {
            title: title.into(),
            section: None,
            priority: None,
            due: None,
            due_time: None,
            note: None,
            labels: labels.iter().map(|s| s.to_string()).collect(),
            parent_no: None,
            rrule: None,
            reminders: vec![],
        }
    }

    fn keys(s: &ProjectStore) -> Vec<String> {
        s.view_options().into_keys().collect()
    }

    #[test]
    fn orphan_project_and_label_rows_are_pruned_at_open() {
        let mut e = env();
        e.store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        e.store
            .add_label("急ぎ", "var(--color-text-muted)")
            .unwrap();
        // A label that exists only on a task still counts as in use.
        e.store.add_task("仕事", task("a", &["食品"])).unwrap();
        e.store.save("仕事").unwrap();
        for k in [
            "表示:今日",
            "表示:プロジェクト:仕事",
            "表示:プロジェクト:無い",
            "表示:ラベル:急ぎ",
            "表示:ラベル:食品",
            "表示:ラベル:無い",
        ] {
            e.store.set_view_option(k, "x=1").unwrap();
        }
        e.store.save_common().unwrap();

        let s = e.reopen();
        assert_eq!(
            keys(&s),
            vec![
                "表示:プロジェクト:仕事",
                "表示:ラベル:急ぎ",
                "表示:ラベル:食品",
                "表示:今日",
            ]
        );
        assert!(s.common_dirty);
    }

    #[test]
    fn open_without_orphans_leaves_the_common_book_clean() {
        let mut e = env();
        e.store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        e.store
            .set_view_option("表示:プロジェクト:仕事", "x=1")
            .unwrap();
        e.store.save_common().unwrap();
        assert!(!e.reopen().common_dirty);
    }

    /// A rename here (仕事 → 業務) merged with another device's write to the old key leaves both
    /// rows in the common book; the reload after the sync drops the orphan.
    #[test]
    fn the_sync_reload_prunes_the_old_key_left_by_a_cross_device_rename() {
        let mut e = env();
        e.store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        e.store
            .set_view_option("表示:プロジェクト:仕事", "a=1")
            .unwrap();
        e.store.rename_project("仕事", "業務").unwrap();
        // The merged book as the sync writes it: our moved row plus the remote's late write.
        e.store
            .set_view_option("表示:プロジェクト:仕事", "b=2")
            .unwrap();
        e.store.save_common().unwrap();

        e.store.reload_common().unwrap();
        assert_eq!(keys(&e.store), vec!["表示:プロジェクト:業務"]);
        assert_eq!(e.store.view_options()["表示:プロジェクト:業務"], "a=1");
        assert!(e.store.common_dirty);
    }

    /// During a sync the common book is reloaded before the project books: a label another
    /// device just put on a task (with its 表示 row) is not in use here yet, so the reload keeps
    /// the row. Label orphans are pruned at the next open only.
    #[test]
    fn the_sync_reload_keeps_a_label_row_whose_task_has_not_arrived_yet() {
        let mut e = env();
        e.store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        e.store.save("仕事").unwrap();
        e.store.set_view_option("表示:ラベル:新", "x=1").unwrap();
        e.store.save_common().unwrap();

        e.store.reload_common().unwrap();
        assert_eq!(keys(&e.store), vec!["表示:ラベル:新"]);
        assert!(!e.store.common_dirty);

        // At the next start the label is still nowhere in use: the row is pruned then.
        let s = e.reopen();
        assert!(s.view_options().is_empty());
        assert!(s.common_dirty);
    }

    #[test]
    fn a_rename_drops_a_stale_row_at_the_new_key_even_without_an_old_row() {
        let mut e = env();
        e.store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        e.store
            .set_view_option("表示:プロジェクト:業務", "stale=1")
            .unwrap();
        e.store.rename_project("仕事", "業務").unwrap();
        assert!(e.store.view_options().is_empty());

        e.store
            .add_label("急ぎ", "var(--color-text-muted)")
            .unwrap();
        e.store
            .set_view_option("表示:ラベル:至急", "stale=1")
            .unwrap();
        e.store.rename_label("急ぎ", "至急").unwrap();
        assert!(e.store.view_options().is_empty());
    }
}
