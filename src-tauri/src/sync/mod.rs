//! Sync of the data folder with a NAS or Google Drive (spec section 3).
//!
//! This module holds the pure part: which files take part ([`is_sync_target`]), how a conflict
//! copy is named ([`conflict_name`]) and what to do with each file ([`plan`]). Talking to the
//! remote is [`backend`], the record of the last sync is [`state`], running a sync against the
//! store is [`engine`].

pub mod backend;
pub mod engine;
pub mod secrets;
pub mod state;
pub mod tailnet;
pub mod webdav;

pub use engine::{
    RunOutcome, SyncEngine, SyncHost, SyncPhase, SyncReason, SyncReport, SyncStatusView,
};

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{NaiveDateTime, Timelike};
use serde::Serialize;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::domain::INBOX;
use crate::store::common_book::COMMON_FILE;
use crate::store::project_store::{CONFLICT_MARK, adoptable_stem};

use self::backend::RemoteFile;
use self::state::{FileRecord, SyncState};

/// A `*.xlsx` file in the data folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFile {
    pub name: String,
    /// SHA-256 of the content, lower-case hex.
    pub hash: String,
    /// Modification time of the file, local time.
    pub modified: NaiveDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
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
    /// Both sides changed (or both are new with different content). `keep` is the winner (the
    /// newer side, the remote on a tie; always the remote when there is no record yet); the
    /// loser's content is saved as a conflict copy (see [`conflict_name`]) locally and remotely.
    Conflict {
        name: String,
        keep: Side,
    },
    /// New on both sides with the same content: only write the record.
    Record(String),
    /// Several names differ only in case or Unicode normalization (or a remote holds the same
    /// name twice and the record cannot tell which one is ours). Nothing is done with them;
    /// the user has to rename. Sorted, without repeats.
    NameClash {
        names: Vec<String>,
    },
    /// The listing of `side` looks wiped: the state knows files other than the protected ones
    /// but the side lists none (an empty or unmounted folder, a remote that was reset). `plan`
    /// returns only this (see [`PlanMode`]); the engine reports it
    /// (「同期先が空に見えるため同期を止めました」) and does not sync until the user chooses
    /// `MirrorRemote` or `MirrorLocal`.
    Suspect {
        side: Side,
    },
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
/// other extensions (also `.XLSX`: the store reads and writes `<project>.xlsx`, so another
/// spelling of the extension would download into a file it never reads) and anything with a
/// path separator are left alone.
pub fn is_sync_target(name: &str) -> bool {
    if name.contains(['/', '\\']) || name.contains(CONFLICT_MARK) || !name.ends_with(".xlsx") {
        return false;
    }
    name == COMMON_FILE || adoptable_stem(Path::new(name)).is_some()
}

/// The name of the conflict copy of `name`: `受信トレイ (競合 2026-10-16 0930).xlsx`.
pub fn conflict_name(name: &str, at: NaiveDateTime) -> String {
    let stem = match name.len().checked_sub(5) {
        Some(i) if name.is_char_boundary(i) && name[i..].eq_ignore_ascii_case(".xlsx") => {
            &name[..i]
        }
        _ => name,
    };
    format!("{stem} {CONFLICT_MARK}{}).xlsx", at.format("%Y-%m-%d %H%M"))
}

/// The key two names must not share: Unicode NFC, lower case. macOS and Windows treat names
/// that fold alike as one file, Drive and WebDAV servers may not.
fn fold(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

/// Files that are never archived because of a deletion on the other side: the inbox and the
/// common workbook must always exist (the app recreates them), so a deletion would only flap.
fn is_protected(key: &str) -> bool {
    key == fold(&format!("{INBOX}.xlsx")) || key == fold(COMMON_FILE)
}

/// Whole seconds: file systems and backends differ in sub-second precision.
fn secs(t: NaiveDateTime) -> NaiveDateTime {
    t.with_nanosecond(0).unwrap_or(t)
}

/// How [`plan`] reads the two sides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanMode {
    /// The normal sync: the records say what changed since the last sync.
    Normal,
    /// One-shot, chosen by the user after a [`Action::Suspect`]: make this folder equal to the
    /// remote. Guard and records are ignored (a record only tells apart Drive files of the same
    /// name). `Download` for every remote target (the engine skips the ones whose content is
    /// equal), `ArchiveLocal` for every local-only target except the protected files. The
    /// remote is never touched.
    MirrorRemote,
    /// One-shot, the other way: make the remote equal to this folder. `Upload` for every local
    /// target (the engine skips equal content), `ArchiveRemote` for every remote-only target
    /// except the protected files. The local folder is never touched.
    MirrorLocal,
}

/// Decides what to do with every file (spec section 3.2). `state` is what the last sync left.
///
/// Both listings must be complete. A local file that could not be read (hashing failed, locked)
/// must go into `skip`, not be left out of `local`: a missing file reads as a deletion. Run
/// `plan` only after the store has been opened: opening recreates the protected files in an
/// empty folder, and the guard below is what keeps that from looking like a healthy folder.
///
/// Wiped-side guard (`PlanMode::Normal`): a side is wiped when `state` has records for files
/// other than the protected ones (the inbox and the common workbook) while that side lists no
/// such file. A wiped listing is far likelier than everything having been deleted. Then `plan`
/// returns only `Suspect { side }` (local first, both when both are wiped): no upload, download,
/// archive, conflict or record. Anything else could make the next round look healthy (a
/// download makes the local side list a file again) and spread the damage. The sync stays
/// stopped until the user picks [`PlanMode::MirrorRemote`] or [`PlanMode::MirrorLocal`] once.
///
/// Names are compared folded (NFC, lower case). Names that fold alike but are spelled
/// differently, on one side or across sides, give a [`Action::NameClash`] and nothing else. The
/// exception is a remote that holds the very same name more than once (Drive allows that): the
/// copy whose id is in the state record is used, without a record it is a clash.
///
/// Files in `skip` (pending external changes, unsaved edits, a save in flight, unreadable files)
/// and files that are not sync targets produce no action. The result is sorted by folded name.
///
/// A file new on both sides counts as the same when the remote `version` equals the local hash
/// (true for a backend whose version is the SHA-256, like the default `MemoryBackend`). Backends
/// that version with an etag or md5 never match here, so the engine gets a `Conflict` (keeping
/// the remote) it can settle after comparing the downloaded content.
pub fn plan(
    local: &[LocalFile],
    remote: &[RemoteFile],
    state: &SyncState,
    skip: &BTreeSet<String>,
    mode: PlanMode,
) -> Vec<Action> {
    if mode == PlanMode::Normal {
        let suspects: Vec<Action> = [
            (
                is_wiped(local.iter().map(|f| f.name.as_str()), state),
                Side::Local,
            ),
            (
                is_wiped(remote.iter().map(|f| f.name.as_str()), state),
                Side::Remote,
            ),
        ]
        .into_iter()
        .filter(|(wiped, _)| *wiped)
        .map(|(_, side)| Action::Suspect { side })
        .collect();
        if !suspects.is_empty() {
            return suspects;
        }
    }
    let skip: BTreeSet<String> = skip.iter().map(|n| fold(n)).collect();
    let keep = |name: &str| is_sync_target(name) && !skip.contains(&fold(name));
    let mut locals: BTreeMap<String, Vec<&LocalFile>> = BTreeMap::new();
    for f in local.iter().filter(|f| keep(&f.name)) {
        locals.entry(fold(&f.name)).or_default().push(f);
    }
    let mut remotes: BTreeMap<String, Vec<&RemoteFile>> = BTreeMap::new();
    for f in remote.iter().filter(|f| keep(&f.name)) {
        remotes.entry(fold(&f.name)).or_default().push(f);
    }
    // A record alone (no file on either side) needs no action, so keys come from the files.
    let keys: BTreeSet<&String> = locals.keys().chain(remotes.keys()).collect();
    keys.into_iter()
        .filter_map(|key| {
            let r = match resolve(
                locals.get(key).map(Vec::as_slice).unwrap_or(&[]),
                remotes.get(key).map(Vec::as_slice).unwrap_or(&[]),
                state,
            ) {
                Ok(r) => r,
                Err(clash) => return Some(clash),
            };
            let protected = is_protected(key);
            let name = r.name.to_string();
            match mode {
                PlanMode::Normal => decide(r.name, r.local, r.remote, r.record, protected),
                PlanMode::MirrorRemote => match (r.local, r.remote) {
                    (_, Some(_)) => Some(Action::Download(name)),
                    (Some(_), None) if !protected => Some(Action::ArchiveLocal(name)),
                    _ => None,
                },
                PlanMode::MirrorLocal => match (r.local, r.remote) {
                    (Some(_), _) => Some(Action::Upload(name)),
                    (None, Some(_)) if !protected => Some(Action::ArchiveRemote(name)),
                    _ => None,
                },
            }
        })
        .collect()
}

/// `true` when the state has records for files other than the protected ones but `names` (one
/// side's listing) holds no such sync target.
fn is_wiped<'a>(names: impl Iterator<Item = &'a str>, state: &SyncState) -> bool {
    let ordinary = |n: &str| is_sync_target(n) && !is_protected(&fold(n));
    state.files.keys().any(|n| ordinary(n)) && !{ names }.any(ordinary)
}

/// The files and the record behind one folded name.
struct Resolved<'a> {
    name: &'a str,
    local: Option<&'a LocalFile>,
    remote: Option<&'a RemoteFile>,
    record: Option<&'a FileRecord>,
}

/// One folded name: checks for clashes, picks the files and the record. `Err` is the
/// `NameClash` to report.
fn resolve<'a>(
    locals: &[&'a LocalFile],
    remotes: &[&'a RemoteFile],
    state: &'a SyncState,
) -> Result<Resolved<'a>, Action> {
    let clash = || {
        let names: BTreeSet<String> = locals
            .iter()
            .map(|f| f.name.clone())
            .chain(remotes.iter().map(|f| f.name.clone()))
            .collect();
        Action::NameClash {
            names: names.into_iter().collect(),
        }
    };
    if locals.len() > 1 {
        return Err(clash());
    }
    let local = locals.first().copied();
    let remote_names: BTreeSet<&str> = remotes.iter().map(|f| f.name.as_str()).collect();
    if remote_names.len() > 1 {
        return Err(clash());
    }
    if let (Some(l), Some(name)) = (local, remote_names.first())
        && l.name != *name
    {
        return Err(clash());
    }
    let name = local
        .map(|l| l.name.as_str())
        .or(remote_names.first().copied())
        .ok_or_else(clash)?;
    let record = state.files.get(name);
    let remote = match remotes {
        [] => None,
        [r] => Some(*r),
        // The same name more than once: only the record can say which one is ours.
        many => match record.and_then(|rec| many.iter().find(|r| r.id == rec.remote_id)) {
            Some(r) => Some(*r),
            None => return Err(clash()),
        },
    };
    Ok(Resolved {
        name,
        local,
        remote,
        record,
    })
}

fn decide(
    name: &str,
    local: Option<&LocalFile>,
    remote: Option<&RemoteFile>,
    record: Option<&FileRecord>,
    protected: bool,
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
                // The first sync of this folder: whatever is on the remote stays, so a fresh
                // PC never overwrites it. The local content survives as a conflict copy.
                Some(Action::Conflict {
                    name,
                    keep: Side::Remote,
                })
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
                (true, true) => {
                    let keep = if secs(l.modified) > secs(r.modified) {
                        Side::Local
                    } else {
                        Side::Remote
                    };
                    Some(Action::Conflict { name, keep })
                }
            }
        }
        // Deleted remotely: a local change wins, otherwise follow the deletion (a protected
        // file is put back instead).
        (Some(l), None, Some(rec)) => Some(if protected || l.hash != rec.local_hash {
            Action::Upload(name)
        } else {
            Action::ArchiveLocal(name)
        }),
        // Deleted locally: a remote change wins, otherwise follow the deletion (a protected
        // file is fetched again instead).
        (None, Some(r), Some(rec)) => Some(if protected || r.version != rec.remote_version {
            Action::Download(name)
        } else {
            Action::ArchiveRemote(name)
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::state::BackendKind;
    use super::*;
    use std::path::Path;

    /// `super::plan` in the normal mode (shadows the glob import).
    fn plan(
        local: &[LocalFile],
        remote: &[RemoteFile],
        state: &SyncState,
        skip: &BTreeSet<String>,
    ) -> Vec<Action> {
        super::plan(local, remote, state, skip, PlanMode::Normal)
    }

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
        // An unchanged bystander, so the listings are not empty (see the wiped-listing guard).
        s.files.insert(
            "z.xlsx".into(),
            FileRecord {
                remote_id: "idz".into(),
                remote_version: "vz".into(),
                remote_modified: dt(T0),
                local_hash: "hz".into(),
            },
        );
        s
    }

    fn lf(name: &str, hash: &str, at: &str) -> LocalFile {
        LocalFile {
            name: name.into(),
            hash: hash.into(),
            modified: dt(at),
        }
    }

    fn rf(id: &str, name: &str, version: &str, at: &str) -> RemoteFile {
        RemoteFile {
            id: id.into(),
            name: name.into(),
            version: version.into(),
            modified: dt(at),
            size: 1,
        }
    }

    fn record(id: &str, version: &str, hash: &str) -> FileRecord {
        FileRecord {
            remote_id: id.into(),
            remote_version: version.into(),
            remote_modified: dt(T0),
            local_hash: hash.into(),
        }
    }

    fn fresh() -> SyncState {
        SyncState::new(Path::new("/d"), BackendKind::Nas, "u")
    }

    fn run(l: Option<LocalFile>, r: Option<RemoteFile>, s: &SyncState) -> Vec<Action> {
        let mut l: Vec<_> = l.into_iter().collect();
        let mut r: Vec<_> = r.into_iter().collect();
        if s.files.contains_key("z.xlsx") {
            l.push(lf("z.xlsx", "hz", T0));
            r.push(rf("idz", "z.xlsx", "vz", T0));
        }
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
        // Different content: conflict, and the remote stays whatever the times say (a fresh PC
        // must not overwrite what is already there).
        for (l_at, r_at) in [(T0, T1), (T1, T0), (T0, T0)] {
            let got = run(Some(local("h1", l_at)), Some(remote("v1", r_at)), &fresh());
            assert_eq!(
                got,
                one(Action::Conflict {
                    name: n(),
                    keep: Side::Remote
                })
            );
        }
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
            "a.XLSX",
            "a.Xlsx",
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

    #[test]
    fn empty_remote_listing_never_archives_local_files() {
        let mut st = synced();
        st.files.remove("z.xlsx");
        let l = [lf(NAME, "h0", T0), lf("new.xlsx", "h", T0)];
        // The remote looks wiped: nothing is written, not even the new file.
        let got = plan(&l, &[], &st, &BTreeSet::new());
        assert_eq!(got, one(Action::Suspect { side: Side::Remote }));
        // With a non-empty remote listing the same deletion is followed.
        let r = [rf("idy", "y.xlsx", "vy", T0)];
        let got = plan(&l[..1], &r, &st, &BTreeSet::new());
        assert!(got.contains(&Action::ArchiveLocal(n())));
    }

    #[test]
    fn empty_local_listing_never_archives_remote_files() {
        let mut st = synced();
        st.files.remove("z.xlsx");
        let r = [rf("id", NAME, "v0", T0), rf("idn", "new.xlsx", "v", T0)];
        // The local side looks wiped: only the report, not even the download.
        let got = plan(&[], &r, &st, &BTreeSet::new());
        assert_eq!(got, one(Action::Suspect { side: Side::Local }));
        let l = [lf("y.xlsx", "hy", T0)];
        let got = plan(&l, &r[..1], &st, &BTreeSet::new());
        assert!(got.contains(&Action::ArchiveRemote(n())));
    }

    #[test]
    fn case_variants_clash() {
        // On one side.
        let l = [lf("todo.xlsx", "h", T0), lf("TODO.xlsx", "h", T0)];
        let got = plan(&l, &[], &fresh(), &BTreeSet::new());
        assert_eq!(
            got,
            one(Action::NameClash {
                names: vec!["TODO.xlsx".into(), "todo.xlsx".into()]
            })
        );
        // Across sides.
        let l = [lf("todo.xlsx", "h", T0)];
        let r = [rf("1", "TODO.xlsx", "v", T0)];
        let got = plan(&l, &r, &fresh(), &BTreeSet::new());
        assert_eq!(
            got,
            one(Action::NameClash {
                names: vec!["TODO.xlsx".into(), "todo.xlsx".into()]
            })
        );
    }

    #[test]
    fn composed_and_decomposed_names_clash() {
        let composed = "\u{30C0}.xlsx"; // ダ
        let decomposed = "\u{30BF}\u{3099}.xlsx"; // タ + combining voiced mark
        assert_ne!(composed, decomposed);
        let l = [lf(composed, "h", T0)];
        let r = [rf("1", decomposed, "v", T0)];
        let got = plan(&l, &r, &fresh(), &BTreeSet::new());
        let mut names = vec![composed.to_string(), decomposed.to_string()];
        names.sort();
        assert_eq!(got, one(Action::NameClash { names }));
    }

    #[test]
    fn a_clash_leaves_other_files_alone() {
        let l = [
            lf("todo.xlsx", "h", T0),
            lf("TODO.xlsx", "h", T0),
            lf("b.xlsx", "h", T0),
        ];
        let got = plan(&l, &[], &fresh(), &BTreeSet::new());
        assert_eq!(got.len(), 2);
        assert!(got.contains(&Action::Upload("b.xlsx".into())));
    }

    #[test]
    fn skip_matches_folded_names() {
        let skip: BTreeSet<String> = ["A.XLSX".to_string()].into();
        let got = plan(&[lf("a.xlsx", "h", T0)], &[], &fresh(), &skip);
        assert!(got.is_empty());
    }

    #[test]
    fn drive_duplicates_need_the_record_to_pick_one() {
        let l = [lf(NAME, "h0", T0)];
        let dupes = [rf("id-a", NAME, "va", T1), rf("id-b", NAME, "vb", T0)];
        // No record: clash.
        let got = plan(&l, &dupes, &fresh(), &BTreeSet::new());
        assert_eq!(
            got,
            one(Action::NameClash {
                names: vec![NAME.into()]
            })
        );
        // A record for a file that is not among them: clash as well.
        let mut st = fresh();
        st.files.insert(NAME.into(), record("id-gone", "v0", "h0"));
        let got = plan(&l, &dupes, &st, &BTreeSet::new());
        assert!(matches!(got.as_slice(), [Action::NameClash { .. }]));
        // The record names id-b, which is unchanged: the other copy is ignored.
        st.files.insert(NAME.into(), record("id-b", "vb", "h0"));
        assert!(plan(&l, &dupes, &st, &BTreeSet::new()).is_empty());
        // The record names id-a, which changed since: download.
        st.files.insert(NAME.into(), record("id-a", "v-old", "h0"));
        let got = plan(&l, &dupes, &st, &BTreeSet::new());
        assert_eq!(got, one(Action::Download(NAME.into())));
    }

    #[test]
    fn inbox_and_common_workbook_are_never_archived() {
        let inbox = format!("{}.xlsx", crate::domain::INBOX);
        for name in [inbox.as_str(), "_PowerToDo.xlsx"] {
            let mut st = fresh();
            st.files.insert(name.into(), record("id", "v0", "h0"));
            st.files.insert("z.xlsx".into(), record("idz", "vz", "hz"));
            let bystander_l = lf("z.xlsx", "hz", T0);
            let bystander_r = rf("idz", "z.xlsx", "vz", T0);
            // Remote deleted, local unchanged: upload instead of ArchiveLocal.
            let got = plan(
                &[lf(name, "h0", T0), bystander_l.clone()],
                std::slice::from_ref(&bystander_r),
                &st,
                &BTreeSet::new(),
            );
            assert_eq!(got, one(Action::Upload(name.into())), "{name}");
            // Local deleted, remote unchanged: download instead of ArchiveRemote.
            let got = plan(
                std::slice::from_ref(&bystander_l),
                &[rf("id", name, "v0", T0), bystander_r.clone()],
                &st,
                &BTreeSet::new(),
            );
            assert_eq!(got, one(Action::Download(name.into())), "{name}");
        }
    }

    #[test]
    fn conflict_times_are_compared_in_whole_seconds() {
        use chrono::Timelike;
        let late = dt(T1).with_nanosecond(900_000_000).unwrap();
        let mut l = local("h1", T1);
        l.modified = late;
        let got = run(Some(l), Some(remote("v1", T1)), &synced());
        assert_eq!(
            got,
            one(Action::Conflict {
                name: n(),
                keep: Side::Remote
            })
        );
    }

    #[test]
    fn conflict_name_strips_any_case_of_the_extension() {
        let at = dt("2026-10-16T09:30:00");
        assert_eq!(conflict_name("A.XLSX", at), "A (競合 2026-10-16 0930).xlsx");
        assert_eq!(conflict_name("b", at), "b (競合 2026-10-16 0930).xlsx");
    }

    const INBOX_FILE: &str = "受信トレイ.xlsx";
    const COMMON: &str = "_PowerToDo.xlsx";
    const ALL: [&str; 4] = [INBOX_FILE, COMMON, "a.xlsx", "b.xlsx"];

    /// Records for the two protected files and `a.xlsx`, `b.xlsx`, all in sync.
    fn big_state() -> SyncState {
        let mut st = fresh();
        for name in ALL {
            st.files.insert(name.into(), record(name, "v0", "h0"));
        }
        st
    }

    fn everything_remote() -> Vec<RemoteFile> {
        ALL.into_iter().map(|n| rf(n, n, "v0", T0)).collect()
    }

    fn everything_local() -> Vec<LocalFile> {
        ALL.into_iter().map(|n| lf(n, "h0", T0)).collect()
    }

    #[test]
    fn local_with_only_recreated_protected_files_is_suspect() {
        // The app recreated the inbox and the common workbook in an empty folder: new hashes.
        let l = [lf(INBOX_FILE, "new1", T1), lf(COMMON, "new2", T1)];
        let got = plan(&l, &everything_remote(), &big_state(), &BTreeSet::new());
        assert_eq!(got, one(Action::Suspect { side: Side::Local }));
    }

    #[test]
    fn local_wiped_stops_everything_round_after_round() {
        // A download would make the local side list a file next round and disarm the guard.
        let st = big_state();
        let l = [lf(COMMON, "new2", T1)];
        let mut r = everything_remote();
        for round in 0..3 {
            r[2].version = format!("v{}", round + 1); // a.xlsx changes remotely each round
            r.push(rf(
                &format!("n{round}"),
                &format!("new{round}.xlsx"),
                "v",
                T0,
            ));
            let got = plan(&l, &r, &st, &BTreeSet::new());
            assert_eq!(got, one(Action::Suspect { side: Side::Local }));
        }
    }

    #[test]
    fn both_sides_wiped_report_both() {
        let got = plan(&[], &[], &big_state(), &BTreeSet::new());
        assert_eq!(
            got,
            vec![
                Action::Suspect { side: Side::Local },
                Action::Suspect { side: Side::Remote }
            ]
        );
    }

    #[test]
    fn remote_with_only_protected_files_is_suspect() {
        let r = [rf("1", INBOX_FILE, "v0", T0), rf("2", COMMON, "v0", T0)];
        let mut l = everything_local();
        l[0].hash = "changed".into(); // the inbox changed locally
        l.push(lf("new.xlsx", "h", T0));
        let got = plan(&l, &r, &big_state(), &BTreeSet::new());
        assert_eq!(got, one(Action::Suspect { side: Side::Remote }));
    }

    #[test]
    fn remote_wiped_stays_guarded_round_after_round() {
        // The remote lists nothing (or only a protected file). Nothing is written, so the next
        // round sees the same listing and stays guarded; no protected restore is uploaded.
        let st = big_state();
        for _ in 0..3 {
            let got = plan(&everything_local(), &[], &st, &BTreeSet::new());
            assert_eq!(got, one(Action::Suspect { side: Side::Remote }));
        }
        let r = [rf("2", COMMON, "v0", T0)];
        let got = plan(&everything_local(), &r, &st, &BTreeSet::new());
        assert_eq!(got, one(Action::Suspect { side: Side::Remote }));
    }

    #[test]
    fn healthy_listings_are_not_suspect() {
        let got = plan(
            &everything_local(),
            &everything_remote(),
            &big_state(),
            &BTreeSet::new(),
        );
        assert!(got.is_empty());
        // One ordinary file on each side is enough, and deletions are still followed.
        let mut l = everything_local();
        l.retain(|f| f.name != "b.xlsx");
        let got = plan(&l, &everything_remote(), &big_state(), &BTreeSet::new());
        assert_eq!(got, one(Action::ArchiveRemote("b.xlsx".into())));
    }

    #[test]
    fn only_protected_records_never_make_a_side_suspect() {
        let mut st = fresh();
        st.files.insert(COMMON.into(), record(COMMON, "v0", "h0"));
        let got = plan(&[lf(COMMON, "h1", T0)], &[], &st, &BTreeSet::new());
        assert_eq!(got, one(Action::Upload(COMMON.into())));
    }

    fn mirror(mode: PlanMode, l: &[LocalFile], r: &[RemoteFile], st: &SyncState) -> Vec<Action> {
        super::plan(l, r, st, &BTreeSet::new(), mode)
    }

    #[test]
    fn mirror_remote_copies_the_remote_down_and_archives_local_only_files() {
        // Local: the recreated defaults, a local-only file and a clash; the records are ignored.
        let l = [
            lf(INBOX_FILE, "default", T1),
            lf(COMMON, "default", T1),
            lf("local-only.xlsx", "h", T1),
            lf("a.xlsx", "h0", T0),
            lf("clash.xlsx", "h", T0),
        ];
        let r = [
            rf("1", INBOX_FILE, "v0", T0),
            rf("2", COMMON, "v0", T0),
            rf("3", "a.xlsx", "v0", T0),
            rf("4", "b.xlsx", "v0", T0),
            rf("5", "CLASH.xlsx", "v0", T0),
        ];
        let got = mirror(PlanMode::MirrorRemote, &l, &r, &big_state());
        assert_eq!(
            got,
            vec![
                Action::Download(COMMON.into()),
                Action::Download("a.xlsx".into()),
                Action::Download("b.xlsx".into()),
                Action::NameClash {
                    names: vec!["CLASH.xlsx".into(), "clash.xlsx".into()]
                },
                Action::ArchiveLocal("local-only.xlsx".into()),
                Action::Download(INBOX_FILE.into()),
            ]
        );
    }

    #[test]
    fn mirror_remote_keeps_a_protected_file_the_remote_lacks() {
        let l = [lf(COMMON, "h", T0), lf(INBOX_FILE, "h", T0)];
        let r = [rf("1", "a.xlsx", "v", T0)];
        let got = mirror(PlanMode::MirrorRemote, &l, &r, &big_state());
        assert_eq!(got, one(Action::Download("a.xlsx".into())));
    }

    #[test]
    fn mirror_remote_works_when_the_remote_is_empty_or_the_local_wiped() {
        // Nothing to download, local-only files go (the user chose the remote).
        let l = [lf("x.xlsx", "h", T0)];
        let got = mirror(PlanMode::MirrorRemote, &l, &[], &big_state());
        assert_eq!(got, one(Action::ArchiveLocal("x.xlsx".into())));
        // Empty local folder: everything is downloaded.
        let got = mirror(
            PlanMode::MirrorRemote,
            &[],
            &everything_remote(),
            &big_state(),
        );
        assert_eq!(got.len(), 4);
        assert!(got.iter().all(|a| matches!(a, Action::Download(_))));
    }

    #[test]
    fn mirror_local_copies_the_folder_up_and_archives_remote_only_files() {
        let l = [
            lf(INBOX_FILE, "h", T1),
            lf(COMMON, "h", T1),
            lf("a.xlsx", "h0", T0),
            lf("new.xlsx", "h", T0),
            lf("clash.xlsx", "h", T0),
        ];
        let r = [
            rf("1", "a.xlsx", "v0", T0),
            rf("2", "remote-only.xlsx", "v0", T0),
            rf("3", "CLASH.xlsx", "v0", T0),
        ];
        let got = mirror(PlanMode::MirrorLocal, &l, &r, &big_state());
        assert_eq!(
            got,
            vec![
                Action::Upload(COMMON.into()),
                Action::Upload("a.xlsx".into()),
                Action::NameClash {
                    names: vec!["CLASH.xlsx".into(), "clash.xlsx".into()]
                },
                Action::Upload("new.xlsx".into()),
                Action::ArchiveRemote("remote-only.xlsx".into()),
                Action::Upload(INBOX_FILE.into()),
            ]
        );
    }

    #[test]
    fn mirror_local_keeps_a_remote_only_protected_file() {
        let l = [lf("a.xlsx", "h", T0)];
        let r = [rf("1", COMMON, "v", T0), rf("2", INBOX_FILE, "v", T0)];
        let got = mirror(PlanMode::MirrorLocal, &l, &r, &big_state());
        assert_eq!(got, one(Action::Upload("a.xlsx".into())));
    }

    #[test]
    fn mirror_modes_honour_skip_and_ignore_non_targets() {
        let l = [lf("a.xlsx", "h", T0), lf("~$a.xlsx", "h", T0)];
        let skip: BTreeSet<String> = ["a.xlsx".to_string()].into();
        assert!(super::plan(&l, &[], &fresh(), &skip, PlanMode::MirrorLocal).is_empty());
        assert!(super::plan(&l, &[], &fresh(), &skip, PlanMode::MirrorRemote).is_empty());
    }
}
