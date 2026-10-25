//! The base of a merge (task-level merge spec section 2): per synced file, the content both
//! sides agreed on at the last sync. Kept in the app data dir next to `sync.json`, never in the
//! data folder and never uploaded. A base is only used when its SHA-256 is the record's
//! `local_hash`, so a stale one is harmless.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::store::paths::write_atomic;
use crate::sync::sha256_hex;

#[derive(Debug, Clone)]
pub struct BaseStore {
    dir: PathBuf,
}

impl BaseStore {
    pub const DIR: &'static str = "sync-base";

    pub fn new(app_data_dir: &Path) -> Self {
        BaseStore {
            dir: app_data_dir.join(Self::DIR),
        }
    }

    /// Takes `data_dir/name` as the base when its content is `hash` (what the record says both
    /// sides hold); otherwise drops the base. A failure only loses the base (the next conflict
    /// of this file then makes a conflict copy).
    pub fn keep(&self, name: &str, data_dir: &Path, hash: &str) {
        match fs::read(data_dir.join(name)) {
            Ok(bytes) if sha256_hex(&bytes) == hash => {
                let written = fs::create_dir_all(&self.dir)
                    .map_err(crate::error::AppError::from)
                    .and_then(|()| write_atomic(&self.dir.join(name), &bytes));
                if let Err(e) = written {
                    eprintln!("could not keep the sync base of {name}: {e}");
                    self.remove(name);
                }
            }
            _ => self.remove(name),
        }
    }

    /// The base of `name` when its content is `hash`.
    pub fn get(&self, name: &str, hash: &str) -> Option<Vec<u8>> {
        let bytes = fs::read(self.dir.join(name)).ok()?;
        (sha256_hex(&bytes) == hash).then_some(bytes)
    }

    pub fn remove(&self, name: &str) {
        match fs::remove_file(self.dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => eprintln!("could not remove the sync base of {name}: {e}"),
        }
    }

    /// Drops the bases of files without a record.
    pub fn retain(&self, names: &BTreeSet<String>) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        for e in entries.flatten() {
            let Ok(name) = e.file_name().into_string() else {
                continue;
            };
            if !names.contains(&name) {
                self.remove(&name);
            }
        }
    }

    pub fn clear(&self) {
        match fs::remove_dir_all(&self.dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => eprintln!("could not remove {}: {e}", self.dir.display()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let app = tmp.path().join("app");
        let data = tmp.path().join("data");
        fs::create_dir_all(&data).unwrap();
        (tmp, app, data)
    }

    #[test]
    fn keeps_the_file_with_the_recorded_hash() {
        let (_t, app, data) = dirs();
        fs::write(data.join("仕事.xlsx"), b"one").unwrap();
        let base = BaseStore::new(&app);
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        assert_eq!(
            base.get("仕事.xlsx", &sha256_hex(b"one")),
            Some(b"one".to_vec())
        );
    }

    #[test]
    fn base_with_another_hash_is_not_used() {
        let (_t, app, data) = dirs();
        fs::write(data.join("仕事.xlsx"), b"one").unwrap();
        let base = BaseStore::new(&app);
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        assert_eq!(base.get("仕事.xlsx", &sha256_hex(b"two")), None);
    }

    #[test]
    fn a_file_that_moved_on_removes_the_base() {
        let (_t, app, data) = dirs();
        let base = BaseStore::new(&app);
        fs::write(data.join("仕事.xlsx"), b"one").unwrap();
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        fs::write(data.join("仕事.xlsx"), b"two").unwrap();
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        assert_eq!(base.get("仕事.xlsx", &sha256_hex(b"one")), None);
    }

    #[test]
    fn retain_and_clear() {
        let (_t, app, data) = dirs();
        let base = BaseStore::new(&app);
        for n in ["a.xlsx", "b.xlsx"] {
            fs::write(data.join(n), n.as_bytes()).unwrap();
            base.keep(n, &data, &sha256_hex(n.as_bytes()));
        }
        base.retain(&BTreeSet::from(["a.xlsx".to_string()]));
        assert!(base.get("a.xlsx", &sha256_hex(b"a.xlsx")).is_some());
        assert!(base.get("b.xlsx", &sha256_hex(b"b.xlsx")).is_none());
        base.clear();
        assert!(base.get("a.xlsx", &sha256_hex(b"a.xlsx")).is_none());
    }
}
