//! `fired.json` (仕様 §4.3, §4.5): which reminders already fired, snoozes, the reminders the UI
//! has not taken yet, and when the scheduler last ran. Kept in the app data dir next to
//! `settings.json`, not in the data folder: it is this machine's state, not the user's data.

use std::collections::BTreeSet;
use std::path::Path;

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};

use crate::domain::model::{serde_date, serde_datetime, serde_time};
use crate::error::{AppError, AppResult};
use crate::store::paths::write_atomic;

/// At most this many reminders wait for the UI; the oldest go first.
const PENDING_LIMIT: usize = 200;

/// One reminder that fired (or was found missed at start-up), as the UI shows it.
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
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
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
/// own time.
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

/// The contents of `fired.json`. Times are local and keep their seconds (chrono's own serde
/// format), so a snooze to `now + 10 min` matches itself after a restart.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fired {
    /// The last time the scheduler ran: reminders after it and before now passed while the
    /// app was not running (仕様 §4.5). `None` on the first run (or after a corrupt file).
    #[serde(default)]
    pub last_seen: Option<NaiveDateTime>,
    #[serde(default)]
    pub entries: Vec<FiredEntry>,
    /// Fired reminders the UI has not taken yet (`pending_reminders`).
    #[serde(default)]
    pub pending: Vec<ReminderItem>,
}

/// A fire time no real reminder has: the `at` of an entry made by snoozing a reminder that
/// had not been recorded as fired.
fn placeholder_at() -> NaiveDateTime {
    NaiveDate::from_ymd_opt(1970, 1, 1)
        .expect("valid date")
        .and_time(NaiveTime::MIN)
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

    /// `key` already fired at `at`.
    pub fn contains(&self, key: &ReminderKey, at: NaiveDateTime) -> bool {
        self.entries.iter().any(|e| e.is(key) && e.at == at)
    }

    /// The time `key` was snoozed to, if it was.
    pub fn snooze_until(&self, key: &ReminderKey) -> Option<NaiveDateTime> {
        self.entries
            .iter()
            .filter(|e| e.is(key))
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

    /// Fire `key` again at `until` instead of at its own time. The task's reminder codes are
    /// not changed. Drops `key` from `pending`: the user acted on it.
    pub fn snooze(&mut self, key: &ReminderKey, until: NaiveDateTime) {
        let mut found = false;
        for e in self.entries.iter_mut().filter(|e| e.is(key)) {
            e.snooze_until = Some(until);
            found = true;
        }
        if !found {
            self.entries.push(FiredEntry {
                project: key.project.clone(),
                no: key.no,
                code: key.code.clone(),
                at: placeholder_at(),
                snooze_until: Some(until),
            });
        }
        self.pending.retain(|i| !key.is_item(i));
    }

    /// Forgets everything about one task, so its reminders can fire again (its due date, time
    /// or reminders changed, or it was completed / deleted).
    pub fn forget_task(&mut self, project: &str, no: u32) {
        self.entries
            .retain(|e| !(e.project == project && e.no == no));
        self.pending
            .retain(|i| !(i.project == project && i.no == no));
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
        f.snooze(&key("p", 1, "-0m"), dt("2026-10-13T09:10:42"));
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
            back.snooze_until(&key("p", 1, "-0m")),
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
    fn snooze_without_a_record_still_fires_at_until() {
        let mut f = Fired::default();
        let k = key("p", 1, "-0m");
        f.push_pending([item("p", 1, "-0m", "2026-10-13T09:00")]);
        f.snooze(&k, dt("2026-10-13T09:10"));
        assert_eq!(f.snooze_until(&k), Some(dt("2026-10-13T09:10")));
        assert!(!f.contains(&k, dt("2026-10-13T09:10")));
        assert!(f.pending.is_empty());
        f.mark(&k, dt("2026-10-13T09:10"));
        assert!(f.contains(&k, dt("2026-10-13T09:10")));
    }
}
