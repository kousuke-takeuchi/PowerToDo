//! `fired.json` (仕様 §4.3, §4.5): which reminders already fired, snoozes, the reminders the UI
//! has not taken yet, and when the scheduler last ran. Kept in the app data dir next to
//! `settings.json`, not in the data folder: it is this machine's state, not the user's data.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};

use crate::domain::model::{serde_date, serde_datetime, serde_time};
use crate::error::{AppError, AppResult};
use crate::store::paths::write_atomic;

/// At most this many reminders wait for the UI; the oldest go first.
const PENDING_LIMIT: usize = 200;

/// One reminder that fired (or was found missed at start-up), as the UI shows it.
///
/// Contract with the UI: `reminder-fired` carries the reminders of one look, and every one of
/// them also waits in [`Fired::pending`]. The UI calls `pending_reminders` on mount and on
/// every `reminder-fired` event and shows what that returns; the call drains the list, so a
/// reminder is shown once even when the window was hidden or the page reloaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderItem {
    pub project: String,
    pub no: u32,
    pub title: String,
    pub code: String,
    /// When it fired (the snooze time for a snoozed reminder).
    #[serde(with = "serde_datetime")]
    pub at: NaiveDateTime,
    #[serde(default, with = "serde_date::option")]
    pub due: Option<NaiveDate>,
    #[serde(default, with = "serde_time::option")]
    pub due_time: Option<NaiveTime>,
}

/// One reminder of one task: a task can carry several codes.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ReminderKey {
    pub project: String,
    pub no: u32,
    pub code: String,
}

impl ReminderKey {
    pub fn of(item: &ReminderItem) -> Self {
        ReminderKey {
            project: item.project.clone(),
            no: item.no,
            code: item.code.clone(),
        }
    }

    fn is_item(&self, item: &ReminderItem) -> bool {
        self.project == item.project && self.no == item.no && self.code == item.code
    }
}

/// A reminder that fired at `at`. `snooze_until` set: fire it again then instead of at its
/// own time, as long as its own time is still `at` (see [`Fired::snooze_until`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FiredEntry {
    pub project: String,
    pub no: u32,
    pub code: String,
    pub at: NaiveDateTime,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snooze_until: Option<NaiveDateTime>,
}

impl FiredEntry {
    fn is(&self, key: &ReminderKey) -> bool {
        self.project == key.project && self.no == key.no && self.code == key.code
    }
}

/// A reminder registered with the OS as a scheduled local notification (iOS, 仕様 §5). The OS
/// delivers it while the app is away; [`Fired::mark_passed_scheduled`] then records it as fired.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledEntry {
    pub key: ReminderKey,
    pub at: NaiveDateTime,
    /// The notification id the OS knows it by (`scheduler::notification_id`).
    pub id: i32,
}

/// The contents of `fired.json`. Times are local and keep their seconds (chrono's own serde
/// format), so a snooze to `now + 10 min` matches itself after a restart.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fired {
    /// The data folder the records belong to. Project names repeat across folders (受信トレイ
    /// is in every one), so records of another folder are dropped on a switch ([`Fired::bind`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<PathBuf>,
    /// The last time the scheduler ran: reminders after it and before now passed while the
    /// app was not running (仕様 §4.5). `None` on the first run (or after a corrupt file).
    #[serde(default)]
    pub last_seen: Option<NaiveDateTime>,
    #[serde(default)]
    pub entries: Vec<FiredEntry>,
    /// Fired reminders the UI has not taken yet (`pending_reminders`).
    #[serde(default)]
    pub pending: Vec<ReminderItem>,
    /// iOS: the reminders handed to the OS to fire at their time (empty elsewhere). Old files
    /// have none.
    #[serde(default)]
    pub scheduled: Vec<ScheduledEntry>,
    /// Set by [`Fired::bind`] when the folder changed; the scheduler takes it and treats its
    /// next look as a start (one summary instead of a notification per task). Not saved.
    #[serde(skip)]
    pub rebound: bool,
}

impl Fired {
    pub const FILE: &'static str = "fired.json";

    /// Empty when the file is missing or cannot be read (仕様 §7: a corrupt file is treated as
    /// empty and overwritten by the next save).
    pub fn load(app_data_dir: &Path) -> Fired {
        let path = app_data_dir.join(Self::FILE);
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                eprintln!("{} is not readable, starting empty: {e}", path.display());
                Fired::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Fired::default(),
            Err(e) => {
                eprintln!("{} is not readable, starting empty: {e}", path.display());
                Fired::default()
            }
        }
    }

    /// Creates `app_data_dir` if needed.
    pub fn save(&self, app_data_dir: &Path) -> AppResult<()> {
        std::fs::create_dir_all(app_data_dir)?;
        let json = serde_json::to_string_pretty(self).map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        write_atomic(&app_data_dir.join(Self::FILE), json.as_bytes())
    }

    /// Ties the records to `data_dir`. Records of another folder are dropped (the run times in
    /// `last_seen` stay: they are about the app, not the folder). A file without a folder (the
    /// first run, a file from before folders were recorded) adopts this one. `true` when
    /// something changed.
    pub fn bind(&mut self, data_dir: &Path) -> bool {
        match self.data_dir.as_deref() {
            Some(d) if d == data_dir => false,
            Some(_) => {
                self.entries.clear();
                self.pending.clear();
                self.data_dir = Some(data_dir.to_path_buf());
                self.rebound = true;
                true
            }
            None => {
                self.data_dir = Some(data_dir.to_path_buf());
                self.rebound = true;
                true
            }
        }
    }

    /// `key` already fired at `at`.
    pub fn contains(&self, key: &ReminderKey, at: NaiveDateTime) -> bool {
        self.entries.iter().any(|e| e.is(key) && e.at == at)
    }

    /// The time `key` was snoozed to, if the snooze is about its current fire time
    /// `fire_at`. A snooze made before the task's due date moved (「期限切れを今日に」, an edit in
    /// Excel: neither forgets the records) is about the old time and is ignored, so the new
    /// time fires instead of being silently skipped.
    pub fn snooze_until(&self, key: &ReminderKey, fire_at: NaiveDateTime) -> Option<NaiveDateTime> {
        self.entries
            .iter()
            .filter(|e| e.is(key) && e.at == fire_at)
            .filter_map(|e| e.snooze_until)
            .max()
    }

    /// Records that `key` fired at `at`. A snooze on `key` stays: its time is the `at` that
    /// now matches, so it does not fire again.
    pub fn mark(&mut self, key: &ReminderKey, at: NaiveDateTime) {
        if !self.contains(key, at) {
            self.entries.push(FiredEntry {
                project: key.project.clone(),
                no: key.no,
                code: key.code.clone(),
                at,
                snooze_until: None,
            });
        }
    }

    /// The OS delivers a scheduled reminder at its time even while the app is not running, so
    /// the ones whose time has come are recorded as fired and dropped from `scheduled`. Returns
    /// how many.
    pub fn mark_passed_scheduled(&mut self, now: NaiveDateTime) -> usize {
        let (passed, waiting): (Vec<_>, Vec<_>) = std::mem::take(&mut self.scheduled)
            .into_iter()
            .partition(|s| s.at <= now);
        self.scheduled = waiting;
        for s in &passed {
            self.mark(&s.key, s.at);
        }
        passed.len()
    }

    /// Fire `key` again at `until` instead of at its own time. `fire_at` is the reminder's
    /// current fire time (`None`: the task is gone or the reminder has no time): when it has no
    /// record yet (a banner row whose record was dropped), one is made, since the snooze only
    /// holds for the record of the current fire time. The task's reminder codes are not
    /// changed. Drops `key` from `pending`: the user acted on it.
    pub fn snooze(
        &mut self,
        key: &ReminderKey,
        fire_at: Option<NaiveDateTime>,
        until: NaiveDateTime,
    ) {
        if let Some(at) = fire_at {
            self.mark(key, at);
        }
        for e in self.entries.iter_mut().filter(|e| e.is(key)) {
            e.snooze_until = Some(until);
        }
        self.pending.retain(|i| !key.is_item(i));
    }

    /// The fire time a snooze may be bound to: the task's current fire time, but only once it
    /// has come. A stale banner row or an old notification can be snoozed after the task's due
    /// date already moved to the future; binding the snooze to that future time would mark it
    /// as fired and the next occurrence's reminder would never ring. Unbound, the snooze is
    /// ignored and the reminder fires at its own time.
    pub fn snooze_binding(
        fire_at: Option<NaiveDateTime>,
        now: NaiveDateTime,
    ) -> Option<NaiveDateTime> {
        fire_at.filter(|at| *at <= now)
    }

    /// Forgets everything about one task, so its reminders can fire again (its due date, time
    /// or reminders changed, or it was completed / deleted).
    pub fn forget_task(&mut self, project: &str, no: u32) {
        self.entries
            .retain(|e| !(e.project == project && e.no == no));
        self.pending
            .retain(|i| !(i.project == project && i.no == no));
    }

    /// `key` has a record whose fire time is `at` to the minute (notification extras and the UI
    /// carry minutes; a snooze time can have seconds).
    pub fn contains_minute(&self, key: &ReminderKey, at: NaiveDateTime) -> bool {
        let minute = |t: NaiveDateTime| t.format("%Y-%m-%dT%H:%M").to_string();
        let at = minute(at);
        self.entries.iter().any(|e| e.is(key) && minute(e.at) == at)
    }

    /// Forgets every task of a deleted project.
    pub fn forget_project(&mut self, project: &str) {
        self.entries.retain(|e| e.project != project);
        self.pending.retain(|i| i.project != project);
    }

    /// Moves the records of a renamed project to its new name (the task numbers stay), so its
    /// reminders do not fire a second time.
    pub fn rename_project(&mut self, from: &str, to: &str) {
        self.forget_project(to);
        for e in self.entries.iter_mut().filter(|e| e.project == from) {
            e.project = to.to_string();
        }
        for i in self.pending.iter_mut().filter(|i| i.project == from) {
            i.project = to.to_string();
        }
    }

    /// Drops records of tasks that no longer exist (`keys` = every `(project, no)` there is).
    pub fn retain_existing(&mut self, keys: &BTreeSet<(String, u32)>) {
        let exists = |project: &str, no: u32| keys.contains(&(project.to_string(), no));
        self.entries.retain(|e| exists(&e.project, e.no));
        self.pending.retain(|i| exists(&i.project, i.no));
    }

    /// Adds reminders for the UI. A reminder already waiting is replaced by its newer firing.
    pub fn push_pending(&mut self, items: impl IntoIterator<Item = ReminderItem>) {
        for item in items {
            let key = ReminderKey::of(&item);
            self.pending.retain(|i| !key.is_item(i));
            self.pending.push(item);
        }
        let over = self.pending.len().saturating_sub(PENDING_LIMIT);
        self.pending.drain(..over);
    }

    /// Hands the waiting reminders to the UI.
    pub fn take_pending(&mut self) -> Vec<ReminderItem> {
        std::mem::take(&mut self.pending)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M")
            .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
            .unwrap()
    }

    fn key(project: &str, no: u32, code: &str) -> ReminderKey {
        ReminderKey {
            project: project.into(),
            no,
            code: code.into(),
        }
    }

    fn item(project: &str, no: u32, code: &str, at: &str) -> ReminderItem {
        ReminderItem {
            project: project.into(),
            no,
            title: format!("t{no}"),
            code: code.into(),
            at: dt(at),
            due: None,
            due_time: None,
        }
    }

    #[test]
    fn missing_or_corrupt_file_loads_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(Fired::load(tmp.path()), Fired::default());
        std::fs::write(tmp.path().join(Fired::FILE), "{ not json").unwrap();
        assert_eq!(Fired::load(tmp.path()), Fired::default());
        // A corrupt file is overwritten by the next save.
        let mut f = Fired::default();
        f.mark(&key("p", 1, "-0m"), dt("2026-10-13T09:00"));
        f.save(tmp.path()).unwrap();
        assert_eq!(Fired::load(tmp.path()), f);
    }

    #[test]
    fn save_and_load_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("not-yet");
        let mut f = Fired {
            last_seen: Some(dt("2026-10-13T09:00:30")),
            ..Fired::default()
        };
        f.mark(&key("p", 1, "-0m"), dt("2026-10-13T09:00"));
        f.snooze(
            &key("p", 1, "-0m"),
            Some(dt("2026-10-13T09:00")),
            dt("2026-10-13T09:10:42"),
        );
        f.mark(&key("仕事", 2, "2026-10-20T09:00"), dt("2026-10-20T09:00"));
        f.push_pending([ReminderItem {
            due: Some(NaiveDate::from_ymd_opt(2026, 10, 13).unwrap()),
            due_time: Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
            ..item("p", 1, "-0m", "2026-10-13T09:00")
        }]);
        f.save(&dir).unwrap();
        let back = Fired::load(&dir);
        assert_eq!(back, f);
        assert_eq!(
            back.snooze_until(&key("p", 1, "-0m"), dt("2026-10-13T09:00")),
            Some(dt("2026-10-13T09:10:42"))
        );

        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(Fired::FILE)).unwrap()).unwrap();
        assert_eq!(json["lastSeen"], "2026-10-13T09:00:30");
        assert_eq!(json["entries"][0]["snoozeUntil"], "2026-10-13T09:10:42");
        assert_eq!(json["pending"][0]["at"], "2026-10-13T09:00");
        assert_eq!(json["pending"][0]["dueTime"], "09:00");
    }

    #[test]
    fn retain_existing_drops_vanished_tasks() {
        let mut f = Fired::default();
        f.mark(&key("p", 1, "-0m"), dt("2026-10-13T09:00"));
        f.mark(&key("p", 2, "-0m"), dt("2026-10-13T09:00"));
        f.mark(&key("q", 1, "-1d"), dt("2026-10-12T09:00"));
        f.push_pending([
            item("p", 2, "-0m", "2026-10-13T09:00"),
            item("q", 1, "-1d", "2026-10-12T09:00"),
        ]);
        let keys = BTreeSet::from([("p".to_string(), 1), ("q".to_string(), 1)]);
        f.retain_existing(&keys);
        let left: Vec<_> = f
            .entries
            .iter()
            .map(|e| (e.project.as_str(), e.no))
            .collect();
        assert_eq!(left, vec![("p", 1), ("q", 1)]);
        assert_eq!(f.pending, vec![item("q", 1, "-1d", "2026-10-12T09:00")]);
    }

    #[test]
    fn forget_task_clears_entries_and_pending_of_that_task_only() {
        let mut f = Fired::default();
        f.mark(&key("p", 1, "-0m"), dt("2026-10-13T09:00"));
        f.mark(&key("p", 1, "-1d"), dt("2026-10-12T09:00"));
        f.mark(&key("p", 2, "-0m"), dt("2026-10-13T09:00"));
        f.push_pending([
            item("p", 1, "-0m", "2026-10-13T09:00"),
            item("p", 2, "-0m", "2026-10-13T09:00"),
        ]);
        f.forget_task("p", 1);
        assert_eq!(f.entries.len(), 1);
        assert_eq!(f.entries[0].no, 2);
        assert_eq!(f.pending, vec![item("p", 2, "-0m", "2026-10-13T09:00")]);
    }

    #[test]
    fn pending_replaces_the_same_reminder_and_is_capped() {
        let mut f = Fired::default();
        f.push_pending([item("p", 1, "-0m", "2026-10-13T09:00")]);
        f.push_pending([item("p", 1, "-0m", "2026-10-13T09:10")]);
        assert_eq!(f.pending, vec![item("p", 1, "-0m", "2026-10-13T09:10")]);
        f.push_pending(
            (0..PENDING_LIMIT as u32 + 5).map(|no| item("q", no, "-0m", "2026-10-13T09:00")),
        );
        assert_eq!(f.pending.len(), PENDING_LIMIT);
        assert_eq!(f.pending.last().unwrap().no, PENDING_LIMIT as u32 + 4);
        assert_eq!(f.take_pending().len(), PENDING_LIMIT);
        assert!(f.pending.is_empty());
    }

    #[test]
    fn switching_folders_drops_the_other_folders_records() {
        let mut f = Fired {
            last_seen: Some(dt("2026-10-13T09:00")),
            ..Fired::default()
        };
        f.mark(&key("受信トレイ", 1, "-0m"), dt("2026-10-13T09:00"));
        // No folder recorded yet: adopt it, keep the records.
        assert!(f.bind(Path::new("/a")));
        assert_eq!(f.entries.len(), 1);
        assert!(!f.bind(Path::new("/a")));
        f.push_pending([item("受信トレイ", 1, "-0m", "2026-10-13T09:00")]);
        // Another folder has its own 受信トレイ #1: nothing carries over.
        assert!(f.bind(Path::new("/b")));
        assert!(f.entries.is_empty());
        assert!(f.pending.is_empty());
        assert_eq!(f.data_dir.as_deref(), Some(Path::new("/b")));
        assert_eq!(f.last_seen, Some(dt("2026-10-13T09:00")));
        // Persisted with the folder.
        let tmp = tempfile::tempdir().unwrap();
        f.save(tmp.path()).unwrap();
        assert_eq!(
            Fired::load(tmp.path()).data_dir.as_deref(),
            Some(Path::new("/b"))
        );
    }

    #[test]
    fn rename_moves_records_and_delete_forgets_them() {
        let mut f = Fired::default();
        f.mark(&key("p", 1, "-0m"), dt("2026-10-13T09:00"));
        f.mark(&key("q", 1, "-0m"), dt("2026-10-13T09:00"));
        f.push_pending([item("p", 1, "-0m", "2026-10-13T09:00")]);
        f.rename_project("p", "r");
        assert!(f.contains(&key("r", 1, "-0m"), dt("2026-10-13T09:00")));
        assert!(!f.contains(&key("p", 1, "-0m"), dt("2026-10-13T09:00")));
        assert_eq!(f.pending[0].project, "r");
        f.forget_project("r");
        assert_eq!(f.entries.len(), 1);
        assert_eq!(f.entries[0].project, "q");
        assert!(f.pending.is_empty());
    }

    #[test]
    fn contains_minute_ignores_seconds() {
        let mut f = Fired::default();
        let k = key("p", 1, "-0m");
        f.mark(&k, dt("2026-10-13T09:10:42"));
        assert!(f.contains_minute(&k, dt("2026-10-13T09:10")));
        assert!(!f.contains_minute(&k, dt("2026-10-13T09:11")));
        assert!(!f.contains_minute(&key("p", 1, "-1d"), dt("2026-10-13T09:10")));
    }

    #[test]
    fn snooze_without_a_record_still_fires_at_until() {
        let mut f = Fired::default();
        let k = key("p", 1, "-0m");
        f.push_pending([item("p", 1, "-0m", "2026-10-13T09:00")]);
        f.snooze(&k, Some(dt("2026-10-13T09:00")), dt("2026-10-13T09:10"));
        assert_eq!(
            f.snooze_until(&k, dt("2026-10-13T09:00")),
            Some(dt("2026-10-13T09:10"))
        );
        assert!(!f.contains(&k, dt("2026-10-13T09:10")));
        assert!(f.pending.is_empty());
        f.mark(&k, dt("2026-10-13T09:10"));
        assert!(f.contains(&k, dt("2026-10-13T09:10")));
    }

    #[test]
    fn a_snooze_holds_only_for_the_fire_time_it_was_made_for() {
        let mut f = Fired::default();
        let k = key("p", 1, "-0m");
        f.mark(&k, dt("2026-10-13T15:00"));
        f.snooze(&k, Some(dt("2026-10-13T15:00")), dt("2026-10-13T15:10"));
        assert_eq!(
            f.snooze_until(&k, dt("2026-10-13T15:00")),
            Some(dt("2026-10-13T15:10"))
        );
        // The due date moved without the records being forgotten.
        assert_eq!(f.snooze_until(&k, dt("2026-10-14T15:00")), None);
    }

    #[test]
    fn mark_passed_scheduled_marks_only_passed_ones() {
        let mut f = Fired::default();
        let entry = |no, at: &str, id| ScheduledEntry {
            key: key("p", no, "-0m"),
            at: dt(at),
            id,
        };
        f.scheduled = vec![
            entry(1, "2026-10-13T09:00", 1),
            entry(2, "2026-10-13T10:00", 2),
            entry(3, "2026-10-13T11:00", 3),
        ];
        assert_eq!(f.mark_passed_scheduled(dt("2026-10-13T10:00")), 2);
        assert!(f.contains(&key("p", 1, "-0m"), dt("2026-10-13T09:00")));
        assert!(f.contains(&key("p", 2, "-0m"), dt("2026-10-13T10:00")));
        assert!(!f.contains(&key("p", 3, "-0m"), dt("2026-10-13T11:00")));
        assert_eq!(f.scheduled, vec![entry(3, "2026-10-13T11:00", 3)]);
        assert_eq!(f.mark_passed_scheduled(dt("2026-10-13T10:30")), 0);
    }

    #[test]
    fn old_fired_json_without_scheduled_still_loads() {
        let old = r#"{"dataDir":"/d","lastSeen":"2026-10-13T09:00:00","entries":[],"pending":[]}"#;
        let f: Fired = serde_json::from_str(old).unwrap();
        assert!(f.scheduled.is_empty());
        let mut f = f;
        f.scheduled.push(ScheduledEntry {
            key: key("p", 1, "-0m"),
            at: dt("2026-10-13T09:00"),
            id: 7,
        });
        let back: Fired = serde_json::from_str(&serde_json::to_string(&f).unwrap()).unwrap();
        assert_eq!(back, f);
    }
}
