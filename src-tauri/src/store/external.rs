//! Telling an external edit (Excel saved the file) from our own write-back (仕様 §5.1).

use std::path::Path;
use std::time::SystemTime;

use super::common_book::COMMON_FILE;
use super::paths::Paths;
use super::project_store::adoptable_stem;

/// What a workbook looked like on disk right after we last wrote or read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    pub len: u64,
    pub mtime: Option<SystemTime>,
}

/// `None` when the file does not exist (or cannot be inspected).
pub fn fingerprint(path: &Path) -> Option<Fingerprint> {
    let m = std::fs::metadata(path).ok()?;
    Some(Fingerprint {
        len: m.len(),
        mtime: m.modified().ok(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileKind {
    Project(String),
    Common,
    Ignore,
}

/// `path` is directly inside the data folder. Compared as given first (cheap), then
/// canonicalized: the OS may report the real path of a folder reached through a symlink
/// (macOS reports `/private/var/...` for `/var/...`).
fn in_data_dir(paths: &Paths, path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    if parent == paths.data_dir {
        return true;
    }
    matches!(
        (parent.canonicalize(), paths.data_dir.canonicalize()),
        (Ok(a), Ok(b)) if a == b
    )
}

/// Only files directly in the data folder count; Excel lock files (`~$…`), our temp files
/// (`.powertodo-….tmp`), other extensions and `archive/` are ignored.
pub fn classify_path(paths: &Paths, path: &Path) -> FileKind {
    if !in_data_dir(paths, path) {
        return FileKind::Ignore;
    }
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return FileKind::Ignore;
    };
    if name == COMMON_FILE {
        return FileKind::Common;
    }
    match adoptable_stem(path) {
        Some(stem) => FileKind::Project(stem),
        None => FileKind::Ignore,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    OwnWrite,
    Changed,
    Removed,
}

/// Compares what we recorded after our last write / read with what is on disk now.
pub fn verdict(recorded: Option<&Fingerprint>, current: Option<Fingerprint>) -> Verdict {
    match (recorded, current) {
        (_, None) => Verdict::Removed,
        (Some(r), Some(c)) if *r == c => Verdict::OwnWrite,
        _ => Verdict::Changed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    fn paths() -> Paths {
        Paths::new("/data")
    }

    #[test]
    fn classify_ignores_lock_and_temp_files() {
        let p = paths();
        for ignored in [
            "/data/~$受信トレイ.xlsx",
            "/data/.~lock.受信トレイ.xlsx#",
            // The real temp name from `paths::write_atomic`.
            "/data/.powertodo-Ab12Cd.tmp",
            // A temp-looking name with the project extension.
            "/data/.powertodo-Ab12Cd.xlsx",
            "/data/.受信トレイ.xlsx.tmp1234",
            "/data/memo.txt",
            "/data/archive/x.xlsx",
            "/other/仕事.xlsx",
        ] {
            assert!(
                matches!(classify_path(&p, Path::new(ignored)), FileKind::Ignore),
                "{ignored} should be ignored"
            );
        }
        assert!(matches!(
            classify_path(&p, Path::new("/data/_PowerToDo.xlsx")),
            FileKind::Common
        ));
        match classify_path(&p, Path::new("/data/仕事.xlsx")) {
            FileKind::Project(n) => assert_eq!(n, "仕事"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn classify_accepts_a_path_reached_through_a_symlink() {
        let real = tempfile::tempdir().unwrap();
        let link_parent = tempfile::tempdir().unwrap();
        let link = link_parent.path().join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(real.path(), &link).unwrap();
        #[cfg(not(unix))]
        let link = real.path().to_path_buf();
        let p = Paths::new(&link);
        let reported = real.path().canonicalize().unwrap().join("仕事.xlsx");
        assert_eq!(
            classify_path(&p, &reported),
            FileKind::Project("仕事".into())
        );
    }

    #[test]
    fn verdict_tells_own_write_from_external_change() {
        let t0 = UNIX_EPOCH + Duration::from_secs(1_000);
        let rec = Fingerprint {
            len: 10,
            mtime: Some(t0),
        };
        assert!(matches!(
            verdict(
                Some(&rec),
                Some(Fingerprint {
                    len: 10,
                    mtime: Some(t0)
                })
            ),
            Verdict::OwnWrite
        ));
        assert!(matches!(
            verdict(
                Some(&rec),
                Some(Fingerprint {
                    len: 11,
                    mtime: Some(t0)
                })
            ),
            Verdict::Changed
        ));
        assert!(matches!(
            verdict(
                Some(&rec),
                Some(Fingerprint {
                    len: 10,
                    mtime: Some(t0 + Duration::from_secs(2))
                })
            ),
            Verdict::Changed
        ));
        assert!(matches!(
            verdict(
                None,
                Some(Fingerprint {
                    len: 10,
                    mtime: Some(t0)
                })
            ),
            Verdict::Changed
        ));
        assert!(matches!(verdict(Some(&rec), None), Verdict::Removed));
    }

    #[test]
    fn external_write_is_detected_and_own_write_is_not() {
        use crate::domain::TaskInput;
        use crate::store::project_store::ProjectStore;
        use chrono::NaiveDateTime;

        let dir = tempfile::tempdir().unwrap();
        let mut s =
            ProjectStore::open(Paths::new(dir.path()), NaiveDateTime::default, true).unwrap();
        let path = dir.path().join("受信トレイ.xlsx");
        // What open() wrote and read back is already known.
        assert_eq!(
            verdict(s.recorded("受信トレイ"), fingerprint(&path)),
            Verdict::OwnWrite
        );
        // our own write
        s.add_task(
            "受信トレイ",
            TaskInput {
                title: "a".into(),
                section: None,
                priority: None,
                due: None,
                due_time: None,
                note: None,
                labels: vec![],
                parent_no: None,
                rrule: None,
                reminders: vec![],
            },
        )
        .unwrap();
        s.save("受信トレイ").unwrap();
        assert_eq!(
            verdict(s.recorded("受信トレイ"), fingerprint(&path)),
            Verdict::OwnWrite
        );
        // an external program rewrites the file
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut bytes = std::fs::read(&path).unwrap();
        bytes.push(0); // a longer file is a different fingerprint even on coarse mtime filesystems
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(
            verdict(s.recorded("受信トレイ"), fingerprint(&path)),
            Verdict::Changed
        );
        assert_eq!(
            verdict(
                s.recorded("受信トレイ"),
                fingerprint(&dir.path().join("none.xlsx"))
            ),
            Verdict::Removed
        );
    }
}
