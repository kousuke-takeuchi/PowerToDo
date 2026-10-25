//! Spec ⑤ §6: the 「表示」 settings of each screen, as `表示:<screen>` rows of the common book's
//! 設定 sheet (`CommonBook::extra_settings`, which already round-trips and syncs per key).

use std::collections::BTreeMap;

use super::project_store::{ProjectStore, invalid};
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

    /// Moves `<prefix><from>` to `<prefix><to>` (rename), or drops it (`to` = None).
    pub(crate) fn follow_view_option(&mut self, prefix: &str, from: &str, to: Option<&str>) {
        let old = format!("{prefix}{from}");
        let rows = &mut self.common.extra_settings;
        let Some(i) = rows.iter().position(|(k, _)| *k == old) else {
            return;
        };
        match to {
            Some(t) => {
                let new = format!("{prefix}{t}");
                // A stale row already at the new key is replaced by the moved row.
                rows.retain(|(k, _)| *k != new);
                if let Some(row) = rows.iter_mut().find(|(k, _)| *k == old) {
                    row.0 = new;
                }
            }
            None => {
                rows.remove(i);
            }
        }
        self.common_dirty = true;
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
}
