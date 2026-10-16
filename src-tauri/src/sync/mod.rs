//! Sync of the data folder with a NAS or Google Drive (spec section 3).
//!
//! This module holds the pure part: which files take part ([`is_sync_target`]), how a conflict
//! copy is named ([`conflict_name`]) and what to do with each file ([`plan`]). Talking to the
//! remote is [`backend`], the record of the last sync is [`state`].

pub mod backend;
pub mod state;
pub mod tailnet;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::NaiveDateTime;
use sha2::{Digest, Sha256};

use crate::store::common_book::COMMON_FILE;
use crate::store::project_store::adoptable_stem;

use self::backend::RemoteFile;
use self::state::{FileRecord, SyncState};

/// Marks a conflict copy: `<name> (競合 yyyy-mm-dd hhmm).xlsx`. Such files never sync.
const CONFLICT_MARK: &str = "(競合 ";

/// A `*.xlsx` file in the data folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFile {
    pub name: String,
    /// SHA-256 of the content, lower-case hex.
    pub hash: String,
    /// Modification time of the file, local time.
    pub modified: NaiveDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Local,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Upload(String),
    Download(String),
    /// The local file was deleted: move the remote one to `archive/`.
    ArchiveRemote(String),
    /// The remote file was deleted: move the local one to `archive/`.
    ArchiveLocal(String),
    /// Both sides changed. `keep` is the winner (the newer side, the remote on a tie); the
    /// loser's content is saved as a conflict copy (see [`conflict_name`]) locally and remotely.
    Conflict {
        name: String,
        keep: Side,
    },
    /// New on both sides with the same content: only write the record.
    Record(String),
}

/// Lower-case hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `true` for the files that sync: `<project>.xlsx` (the same rule as adopting a workbook into
/// the project list) and the common workbook. Excel lock files, our temp files, conflict copies,
/// other extensions and anything with a path separator are left alone.
pub fn is_sync_target(name: &str) -> bool {
    if name.contains(['/', '\\']) || name.contains(CONFLICT_MARK) {
        return false;
    }
    name == COMMON_FILE || adoptable_stem(Path::new(name)).is_some()
}

/// The name of the conflict copy of `name`: `受信トレイ (競合 2026-10-16 0930).xlsx`.
pub fn conflict_name(name: &str, at: NaiveDateTime) -> String {
    let stem = name.strip_suffix(".xlsx").unwrap_or(name);
    format!("{stem} {CONFLICT_MARK}{}).xlsx", at.format("%Y-%m-%d %H%M"))
}

/// Decides what to do with every file (spec section 3.2). `state` is what the last sync left.
/// Files in `skip` (pending external changes, unsaved edits, a save in flight) and files that
/// are not sync targets produce no action. The result is sorted by file name.
///
/// A file new on both sides counts as the same when the remote `version` equals the local hash
/// (true for a backend whose version is the SHA-256, like `MemoryBackend`). Backends that
/// version with an etag or md5 never match here, so the engine gets a `Conflict` it can settle
/// after comparing the downloaded content.
pub fn plan(
    local: &[LocalFile],
    remote: &[RemoteFile],
    state: &SyncState,
    skip: &BTreeSet<String>,
) -> Vec<Action> {
    let local: BTreeMap<&str, &LocalFile> = local.iter().map(|f| (f.name.as_str(), f)).collect();
    let remote: BTreeMap<&str, &RemoteFile> = remote.iter().map(|f| (f.name.as_str(), f)).collect();
    let names: BTreeSet<&str> = local
        .keys()
        .chain(remote.keys())
        .copied()
        .chain(state.files.keys().map(String::as_str))
        .filter(|n| is_sync_target(n) && !skip.contains(*n))
        .collect();
    names
        .into_iter()
        .filter_map(|name| {
            decide(
                name,
                local.get(name).copied(),
                remote.get(name).copied(),
                state.files.get(name),
            )
        })
        .collect()
}

fn decide(
    name: &str,
    local: Option<&LocalFile>,
    remote: Option<&RemoteFile>,
    record: Option<&FileRecord>,
) -> Option<Action> {
    let name = name.to_string();
    match (local, remote, record) {
        // Nothing on either side: only a stale record, which is not a file action.
        (None, None, _) => None,
        // Never synced.
        (Some(_), None, None) => Some(Action::Upload(name)),
        (None, Some(_), None) => Some(Action::Download(name)),
        (Some(l), Some(r), None) => {
            if r.version == l.hash {
                Some(Action::Record(name))
            } else {
                Some(conflict(name, l, r))
            }
        }
        // Synced before.
        (Some(l), Some(r), Some(rec)) => {
            let local_changed = l.hash != rec.local_hash;
            let remote_changed = r.version != rec.remote_version;
            match (local_changed, remote_changed) {
                (false, false) => None,
                (true, false) => Some(Action::Upload(name)),
                (false, true) => Some(Action::Download(name)),
                // Both moved to the same content (e.g. an upload whose record was not saved).
                (true, true) if r.version == l.hash => Some(Action::Record(name)),
                (true, true) => Some(conflict(name, l, r)),
            }
        }
        // Deleted remotely: a local change wins, otherwise follow the deletion.
        (Some(l), None, Some(rec)) => Some(if l.hash != rec.local_hash {
            Action::Upload(name)
        } else {
            Action::ArchiveLocal(name)
        }),
        // Deleted locally: a remote change wins, otherwise follow the deletion.
        (None, Some(r), Some(rec)) => Some(if r.version != rec.remote_version {
            Action::Download(name)
        } else {
            Action::ArchiveRemote(name)
        }),
    }
}

fn conflict(name: String, local: &LocalFile, remote: &RemoteFile) -> Action {
    let keep = if local.modified > remote.modified {
        Side::Local
    } else {
        Side::Remote
    };
    Action::Conflict { name, keep }
}

#[cfg(test)]
mod tests {
    use super::state::BackendKind;
    use super::*;
    use std::path::Path;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    const NAME: &str = "a.xlsx";
    const T0: &str = "2026-10-16T09:00:00";
    const T1: &str = "2026-10-16T10:00:00";

    fn local(hash: &str, at: &str) -> LocalFile {
        LocalFile {
            name: NAME.into(),
            hash: hash.into(),
            modified: dt(at),
        }
    }

    fn remote(version: &str, at: &str) -> RemoteFile {
        RemoteFile {
            id: "id".into(),
            name: NAME.into(),
            version: version.into(),
            modified: dt(at),
            size: 1,
        }
    }

    /// State after a sync that left local hash `h0` and remote version `v0`.
    fn synced() -> SyncState {
        let mut s = SyncState::new(Path::new("/d"), BackendKind::Nas, "u");
        s.files.insert(
            NAME.into(),
            FileRecord {
                remote_id: "id".into(),
                remote_version: "v0".into(),
                remote_modified: dt(T0),
                local_hash: "h0".into(),
            },
        );
        s
    }

    fn fresh() -> SyncState {
        SyncState::new(Path::new("/d"), BackendKind::Nas, "u")
    }

    fn run(l: Option<LocalFile>, r: Option<RemoteFile>, s: &SyncState) -> Vec<Action> {
        let l: Vec<_> = l.into_iter().collect();
        let r: Vec<_> = r.into_iter().collect();
        plan(&l, &r, s, &BTreeSet::new())
    }

    fn one(a: Action) -> Vec<Action> {
        vec![a]
    }

    fn n() -> String {
        NAME.to_string()
    }

    // The ten rows of the table in spec section 3.2, in order.

    #[test]
    fn row1_local_changed_remote_same_uploads() {
        let got = run(Some(local("h1", T1)), Some(remote("v0", T0)), &synced());
        assert_eq!(got, one(Action::Upload(n())));
    }

    #[test]
    fn row2_local_same_remote_changed_downloads() {
        let got = run(Some(local("h0", T0)), Some(remote("v1", T1)), &synced());
        assert_eq!(got, one(Action::Download(n())));
    }

    #[test]
    fn row3_both_changed_is_a_conflict() {
        let got = run(Some(local("h1", T1)), Some(remote("v1", T0)), &synced());
        assert_eq!(
            got,
            one(Action::Conflict {
                name: n(),
                keep: Side::Local
            })
        );
    }

    #[test]
    fn row4_new_local_only_uploads() {
        let got = run(Some(local("h1", T1)), None, &fresh());
        assert_eq!(got, one(Action::Upload(n())));
    }

    #[test]
    fn row5_new_remote_only_downloads() {
        let got = run(None, Some(remote("v1", T1)), &fresh());
        assert_eq!(got, one(Action::Download(n())));
    }

    #[test]
    fn row6_new_on_both_sides() {
        // Same content: just record it.
        let got = run(Some(local("same", T0)), Some(remote("same", T1)), &fresh());
        assert_eq!(got, one(Action::Record(n())));
        // Different content: conflict.
        let got = run(Some(local("h1", T0)), Some(remote("v1", T1)), &fresh());
        assert_eq!(
            got,
            one(Action::Conflict {
                name: n(),
                keep: Side::Remote
            })
        );
    }

    #[test]
    fn row7_local_deleted_remote_same_archives_remote() {
        let got = run(None, Some(remote("v0", T0)), &synced());
        assert_eq!(got, one(Action::ArchiveRemote(n())));
    }

    #[test]
    fn row8_remote_deleted_local_same_archives_local() {
        let got = run(Some(local("h0", T0)), None, &synced());
        assert_eq!(got, one(Action::ArchiveLocal(n())));
    }

    #[test]
    fn row9_local_deleted_remote_changed_downloads() {
        let got = run(None, Some(remote("v1", T1)), &synced());
        assert_eq!(got, one(Action::Download(n())));
    }

    #[test]
    fn row10_remote_deleted_local_changed_uploads() {
        let got = run(Some(local("h1", T1)), None, &synced());
        assert_eq!(got, one(Action::Upload(n())));
    }

    // Beyond the table.

    #[test]
    fn nothing_changed_means_no_action() {
        let got = run(Some(local("h0", T0)), Some(remote("v0", T0)), &synced());
        assert!(got.is_empty());
    }

    #[test]
    fn gone_on_both_sides_means_no_action() {
        assert!(run(None, None, &synced()).is_empty());
    }

    #[test]
    fn both_changed_to_the_same_content_is_recorded_not_a_conflict() {
        let got = run(Some(local("x", T1)), Some(remote("x", T1)), &synced());
        assert_eq!(got, one(Action::Record(n())));
    }

    #[test]
    fn conflict_winner_is_the_newer_side_and_remote_on_a_tie() {
        let keep = |l_at: &str, r_at: &str| {
            let got = run(Some(local("h1", l_at)), Some(remote("v1", r_at)), &synced());
            match got.as_slice() {
                [Action::Conflict { keep, .. }] => *keep,
                other => panic!("{other:?}"),
            }
        };
        assert_eq!(keep(T1, T0), Side::Local);
        assert_eq!(keep(T0, T1), Side::Remote);
        assert_eq!(keep(T0, T0), Side::Remote);
    }

    #[test]
    fn skipped_names_produce_nothing() {
        let skip: BTreeSet<String> = [n()].into();
        let l = [local("h1", T1)];
        let r = [remote("v1", T1)];
        assert!(plan(&l, &r, &synced(), &skip).is_empty());
        assert!(plan(&l, &[], &fresh(), &skip).is_empty());
        assert!(plan(&[], &r, &fresh(), &skip).is_empty());
        // Only that name is skipped.
        let mut other = local("h1", T1);
        other.name = "b.xlsx".into();
        let got = plan(&[l[0].clone(), other], &[], &fresh(), &skip);
        assert_eq!(got, one(Action::Upload("b.xlsx".into())));
    }

    #[test]
    fn files_that_are_not_sync_targets_are_ignored() {
        let mk = |name: &str| LocalFile {
            name: name.into(),
            hash: "h".into(),
            modified: dt(T0),
        };
        let l = [
            mk("a.xlsx"),
            mk("~$a.xlsx"),
            mk("a (競合 2026-10-16 0930).xlsx"),
            mk("notes.txt"),
        ];
        let r = [RemoteFile {
            id: "1".into(),
            name: ".~lock.b.xlsx#".into(),
            version: "v".into(),
            modified: dt(T0),
            size: 1,
        }];
        assert_eq!(
            plan(&l, &r, &fresh(), &BTreeSet::new()),
            one(Action::Upload("a.xlsx".into()))
        );
    }

    #[test]
    fn output_is_sorted_by_name() {
        let mk = |name: &str| LocalFile {
            name: name.into(),
            hash: "h".into(),
            modified: dt(T0),
        };
        let l = [mk("c.xlsx"), mk("a.xlsx"), mk("b.xlsx")];
        let r = [RemoteFile {
            id: "1".into(),
            name: "_PowerToDo.xlsx".into(),
            version: "v".into(),
            modified: dt(T0),
            size: 1,
        }];
        let got = plan(&l, &r, &fresh(), &BTreeSet::new());
        assert_eq!(
            got,
            vec![
                Action::Download("_PowerToDo.xlsx".into()),
                Action::Upload("a.xlsx".into()),
                Action::Upload("b.xlsx".into()),
                Action::Upload("c.xlsx".into()),
            ]
        );
    }

    #[test]
    fn sync_targets() {
        for ok in [
            "a.xlsx",
            "受信トレイ.xlsx",
            "_PowerToDo.xlsx",
            "my project.xlsx",
        ] {
            assert!(is_sync_target(ok), "{ok}");
        }
        for bad in [
            "a (競合 2026-10-16 0930).xlsx",
            "~$a.xlsx",
            ".~lock.a.xlsx#",
            ".powertodo-abc.tmp",
            ".hidden.xlsx",
            "a.txt",
            "a.xlsx.tmp",
            "a",
            ".xlsx",
            "_other.xlsx",
            "_powertodo.xlsx",
            "sub/a.xlsx",
            "sub\\a.xlsx",
            "archive/a.xlsx",
            "",
        ] {
            assert!(!is_sync_target(bad), "{bad}");
        }
    }

    #[test]
    fn conflict_name_has_the_documented_form_and_does_not_sync() {
        let at = dt("2026-10-16T09:30:45");
        assert_eq!(
            conflict_name("受信トレイ.xlsx", at),
            "受信トレイ (競合 2026-10-16 0930).xlsx"
        );
        for name in ["受信トレイ.xlsx", "_PowerToDo.xlsx", "a.xlsx"] {
            assert!(!is_sync_target(&conflict_name(name, at)), "{name}");
        }
    }

    #[test]
    fn sha256_hex_is_lower_case_hex() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
