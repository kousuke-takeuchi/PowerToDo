//! Reminder firing (仕様 §4.3–4.5): every 30 seconds, find the reminders that are due, record
//! them in `fired.json`, show OS notifications and tell the UI (`reminder-fired`).
//!
//! The decision is the pure [`due_reminders`]; everything that touches Tauri is in [`tick`] and
//! [`on_action`], which are checked by hand.

use std::collections::BTreeSet;
use std::time::Duration as StdDuration;

use chrono::{Duration, Local, NaiveDateTime};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::{Action, ActionPerformed, ActionType, NotificationExt};

use crate::commands::{self, AppState};
use crate::domain::Task;
use crate::domain::reminders;
use crate::store::common_book::Settings;
pub use crate::store::fired::{Fired, ReminderItem, ReminderKey};
use crate::window;

/// How often the scheduler looks for due reminders.
const PERIOD: StdDuration = StdDuration::from_secs(30);
/// Until the data folder is open (the UI opens it with its first `app_state`), look this often,
/// so the start-up summary does not wait a whole period.
const STARTUP_POLL: StdDuration = StdDuration::from_secs(2);
/// Reminders older than this are "missed" (仕様 §4.3).
const FIRE_WINDOW_HOURS: i64 = 24;
/// The notification button 「後で」.
pub const SNOOZE_MINUTES: i64 = 10;

/// The action type of a reminder notification, and its buttons.
pub const ACTION_TYPE: &str = "reminder";
pub const ACTION_DONE: &str = "done";
pub const ACTION_SNOOZE: &str = "snooze";
/// What the plugin reports for a click on the notification itself.
pub const ACTION_TAP: &str = "tap";

/// What one look at the tasks found.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Decision {
    /// Due within the last 24 hours: notify one by one.
    pub fire: Vec<ReminderItem>,
    /// Due more than 24 hours ago and never fired (仕様 §4.5; see [`select_missed`]).
    pub missed: Vec<ReminderItem>,
}

/// The reminders of unfinished tasks that are due at `now` and not yet recorded in `fired`.
/// A snoozed reminder is due at its snooze time instead of its own.
pub fn due_reminders(
    tasks: &[Task],
    fired: &Fired,
    now: NaiveDateTime,
    settings: &Settings,
) -> Decision {
    let mut fire = Vec::new();
    let mut missed = Vec::new();
    for t in tasks.iter().filter(|t| t.progress < 100) {
        for code in &t.reminders {
            let key = ReminderKey {
                project: t.project.clone(),
                no: t.no,
                code: code.clone(),
            };
            let at = match fired.snooze_until(&key) {
                Some(until) => until,
                None => match reminders::fire_time(code, t.due, t.due_time, settings.notify_time) {
                    Some(at) => at,
                    None => continue,
                },
            };
            if at > now || fired.contains(&key, at) {
                continue;
            }
            let item = ReminderItem {
                project: t.project.clone(),
                no: t.no,
                title: t.title.clone(),
                code: code.clone(),
                at,
                due: t.due,
                due_time: t.due_time,
            };
            if now - at <= Duration::hours(FIRE_WINDOW_HOURS) {
                fire.push(item);
            } else {
                missed.push(item);
            }
        }
    }
    Decision { fire, missed }
}

/// The missed reminders that passed while the app was not running: after `last_seen` (the
/// scheduler's previous run). Without a `last_seen` (first run, corrupt `fired.json`) the base
/// is 24 hours ago, so nothing is summarized and only the last 24 hours fire (仕様 §4.5, §7).
/// Older ones were already past while the app ran (a task added with an old date) and stay
/// silent. On a regular tick `last_seen` is 30 s ago, so this is empty unless the machine slept.
pub fn select_missed(
    missed: Vec<ReminderItem>,
    last_seen: Option<NaiveDateTime>,
    now: NaiveDateTime,
) -> Vec<ReminderItem> {
    let base = last_seen.unwrap_or(now - Duration::hours(FIRE_WINDOW_HOURS));
    missed.into_iter().filter(|i| i.at > base).collect()
}

/// Reminders of the same task that fire together become one notification (仕様 §4.3): the
/// first of them and how many there are, in order of first appearance.
pub fn group_by_task(items: &[ReminderItem]) -> Vec<(&ReminderItem, usize)> {
    let mut groups: Vec<(&ReminderItem, usize)> = Vec::new();
    for item in items {
        match groups
            .iter_mut()
            .find(|(first, _)| first.project == item.project && first.no == item.no)
        {
            Some((_, n)) => *n += 1,
            None => groups.push((item, 1)),
        }
    }
    groups
}

/// `<project> · 期限 10/13 15:00`, plus `· 他 N 件` when several reminders of the task fired
/// together.
pub fn notification_body(item: &ReminderItem, count: usize) -> String {
    let mut body = item.project.clone();
    if let Some(due) = item.due {
        body.push_str(" · 期限 ");
        body.push_str(&due.format("%-m/%-d").to_string());
        if let Some(time) = item.due_time {
            body.push(' ');
            body.push_str(&time.format("%-H:%M").to_string());
        }
    }
    if count > 1 {
        body.push_str(&format!(" · 他 {} 件", count - 1));
    }
    body
}

fn now() -> NaiveDateTime {
    Local::now().naive_local()
}

#[derive(Debug, Clone, Serialize)]
struct ReminderFired {
    items: Vec<ReminderItem>,
}

#[derive(Debug, Clone, Serialize)]
struct OpenTask {
    project: String,
    no: u32,
}

/// Registers the reminder buttons and the handler of what the user does with a notification.
/// Call before [`start`]: notifications shown before a handler exists report nothing.
pub fn register(app: &AppHandle) {
    let notification = app.notification();
    let reminder = ActionType::builder(ACTION_TYPE)
        .actions(vec![
            Action::builder(ACTION_DONE, "完了").build(),
            Action::builder(ACTION_SNOOZE, "後で (10 分)").build(),
        ])
        .build();
    if let Err(e) = notification.register_action_types(vec![reminder]) {
        eprintln!("could not register the reminder buttons: {e}");
    }
    let handle = app.clone();
    if let Err(e) = notification.on_action(move |performed| on_action(&handle, performed)) {
        eprintln!("could not listen to notification actions: {e}");
    }
}

/// Starts the scheduler loop: one look right away (with the start-up summary), then every
/// 30 seconds. Skips while no data folder is open.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        while !tick(&app, true) {
            tokio::time::sleep(STARTUP_POLL).await;
        }
        let mut interval = tokio::time::interval(PERIOD);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // The first tick completes at once; the start-up look just ran.
        interval.tick().await;
        loop {
            interval.tick().await;
            tick(&app, false);
        }
    });
}

/// One look at the tasks. `false` when no data folder is open (nothing was done).
///
/// Lock order (see `commands`): the store lock is taken and released first (copying the tasks
/// and settings), then the `fired` lock alone. Notifications and events go out with no lock
/// held.
fn tick(app: &AppHandle, startup: bool) -> bool {
    let state = app.state::<AppState>();
    let Some((tasks, settings)) = state.reminder_inputs() else {
        return false;
    };
    let now = now();
    let (fire, missed) = {
        let mut fired = state.lock_fired();
        let decision = due_reminders(&tasks, &fired, now, &settings);
        let missed = select_missed(decision.missed, fired.last_seen, now);
        // Recorded before notifying: a failed notification is not retried (仕様 §7).
        for item in decision.fire.iter().chain(&missed) {
            fired.mark(&ReminderKey::of(item), item.at);
        }
        if startup {
            let existing: BTreeSet<(String, u32)> =
                tasks.iter().map(|t| (t.project.clone(), t.no)).collect();
            fired.retain_existing(&existing);
        }
        fired.last_seen = Some(now);
        fired.push_pending(decision.fire.iter().chain(&missed).cloned());
        if let Err(e) = fired.save(state.app_data_dir()) {
            eprintln!("could not write {}: {e}", Fired::FILE);
        }
        (decision.fire, missed)
    };

    if settings.notifications {
        for (item, count) in group_by_task(&fire) {
            notify(app, item, count);
        }
        if !missed.is_empty() {
            notify_summary(app, missed.len());
        }
    }
    let items: Vec<ReminderItem> = fire.into_iter().chain(missed).collect();
    if !items.is_empty() {
        let _ = app.emit("reminder-fired", ReminderFired { items });
    }
    true
}

fn notify(app: &AppHandle, item: &ReminderItem, count: usize) {
    let shown = app
        .notification()
        .builder()
        .title(item.title.clone())
        .body(notification_body(item, count))
        .action_type_id(ACTION_TYPE)
        .extra("project", &item.project)
        .extra("no", item.no)
        .extra("code", &item.code)
        .show();
    if let Err(e) = shown {
        eprintln!(
            "could not show the reminder for {}#{}: {e}",
            item.project, item.no
        );
    }
}

/// The start-up summary (仕様 §4.5). A click only brings the window back; the banner lists them.
fn notify_summary(app: &AppHandle, count: usize) {
    let shown = app
        .notification()
        .builder()
        .title("リマインダー")
        .body(format!("{count} 件のリマインダーがありました"))
        .show();
    if let Err(e) = shown {
        eprintln!("could not show the reminder summary: {e}");
    }
}

/// The task a notification was about, from its extra payload
/// (`ActionPerformed::notification()` → `ActiveNotification::extra()`).
fn target(performed: &ActionPerformed) -> Option<(String, u32, Option<String>)> {
    let extra = performed.notification()?.extra();
    let project = extra.get("project")?.as_str()?.to_string();
    let no = u32::try_from(extra.get("no")?.as_u64()?).ok()?;
    let code = extra
        .get("code")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some((project, no, code))
}

/// What the user did with a notification. Runs on the plugin's notification thread, so the
/// work that saves goes to the async runtime (the saver needs it) and this returns at once.
fn on_action(app: &AppHandle, performed: &ActionPerformed) {
    let target = target(performed);
    match performed.action_id() {
        ACTION_TAP => {
            window::show_main_window(app);
            if let Some((project, no, _)) = target {
                let _ = app.emit("open-task", OpenTask { project, no });
            }
        }
        ACTION_DONE => {
            if let Some((project, no, _)) = target {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    commands::complete_from_notification(&app, &project, no);
                });
            }
        }
        ACTION_SNOOZE => {
            if let Some((project, no, Some(code))) = target {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let key = ReminderKey { project, no, code };
                    let until = now() + Duration::minutes(SNOOZE_MINUTES);
                    app.state::<AppState>().snooze_fired(&key, until);
                });
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Priority;
    use chrono::{NaiveDate, NaiveTime};

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M")
            .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
            .unwrap()
    }

    fn task(no: u32, due: &str, time: Option<(u32, u32)>, codes: &[&str], progress: u8) -> Task {
        Task {
            no,
            project: "p".into(),
            category: None,
            title: format!("t{no}"),
            assignee: String::new(),
            priority: Priority(4),
            progress,
            start: None,
            due: Some(NaiveDate::parse_from_str(due, "%Y-%m-%d").unwrap()),
            due_time: time.map(|(h, m)| NaiveTime::from_hms_opt(h, m, 0).unwrap()),
            days: None,
            note: None,
            parent_no: None,
            labels: vec![],
            rrule: None,
            rrule_label: None,
            reminders: codes.iter().map(|c| c.to_string()).collect(),
            order: 0,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    fn settings() -> Settings {
        Settings::default_for_user() // notify 09:00
    }

    #[test]
    fn fires_once_until_task_changes() {
        let t = task(1, "2026-10-13", Some((15, 0)), &["-0m"], 0);
        let mut fired = Fired::default();
        let now = dt("2026-10-13T15:00");
        let d = due_reminders(std::slice::from_ref(&t), &fired, now, &settings());
        assert_eq!(d.fire.len(), 1);
        fired.mark(&ReminderKey::of(&d.fire[0]), d.fire[0].at);
        let d = due_reminders(
            std::slice::from_ref(&t),
            &fired,
            dt("2026-10-13T15:00:30"),
            &settings(),
        );
        assert!(d.fire.is_empty());
        // The due time moves: the old record no longer matches, so it fires again.
        let mut moved = t.clone();
        moved.due_time = Some(NaiveTime::from_hms_opt(16, 0, 0).unwrap());
        let d = due_reminders(&[moved], &fired, dt("2026-10-13T16:00"), &settings());
        assert_eq!(d.fire.len(), 1);
    }

    #[test]
    fn missed_reminders_are_separated_by_24h() {
        let old = task(1, "2026-10-10", Some((9, 0)), &["-0m"], 0);
        let recent = task(2, "2026-10-13", Some((8, 0)), &["-0m"], 0);
        let d = due_reminders(
            &[old, recent],
            &Fired::default(),
            dt("2026-10-13T09:00"),
            &settings(),
        );
        assert_eq!(d.fire.iter().map(|i| i.no).collect::<Vec<_>>(), vec![2]);
        assert_eq!(d.missed.iter().map(|i| i.no).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn the_24h_boundary_still_fires() {
        let t = task(1, "2026-10-12", Some((9, 0)), &["-0m"], 0);
        let d = due_reminders(
            std::slice::from_ref(&t),
            &Fired::default(),
            dt("2026-10-13T09:00"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 1);
        let d = due_reminders(
            &[t],
            &Fired::default(),
            dt("2026-10-13T09:00:01"),
            &settings(),
        );
        assert!(d.fire.is_empty());
        assert_eq!(d.missed.len(), 1);
    }

    #[test]
    fn done_tasks_future_and_timeless_relatives_do_not_fire() {
        let done = task(1, "2026-10-13", Some((9, 0)), &["-0m"], 100);
        let future = task(2, "2026-10-13", Some((9, 0)), &["-0m"], 0);
        let timeless = task(3, "2026-10-13", None, &["-10m"], 0);
        let day_before = task(4, "2026-10-14", None, &["-1d"], 0); // fires 10/13 09:00
        let d = due_reminders(
            &[done, future, timeless, day_before],
            &Fired::default(),
            dt("2026-10-13T08:59"),
            &settings(),
        );
        assert!(d.fire.is_empty());
        let d = due_reminders(
            &[task(4, "2026-10-14", None, &["-1d"], 0)],
            &Fired::default(),
            dt("2026-10-13T09:00"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 1);
    }

    #[test]
    fn snooze_replaces_the_fire_time() {
        let t = task(1, "2026-10-13", Some((9, 0)), &["-0m"], 0);
        let mut fired = Fired::default();
        let key = ReminderKey {
            project: "p".into(),
            no: 1,
            code: "-0m".into(),
        };
        fired.mark(&key, dt("2026-10-13T09:00"));
        fired.snooze(&key, dt("2026-10-13T09:10"));
        assert!(
            due_reminders(
                std::slice::from_ref(&t),
                &fired,
                dt("2026-10-13T09:05"),
                &settings()
            )
            .fire
            .is_empty()
        );
        let d = due_reminders(
            std::slice::from_ref(&t),
            &fired,
            dt("2026-10-13T09:10"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 1);
        assert_eq!(d.fire[0].at, dt("2026-10-13T09:10"));
        // Once the snoozed firing is recorded, it stays quiet.
        fired.mark(&key, d.fire[0].at);
        assert!(
            due_reminders(&[t], &fired, dt("2026-10-13T09:10:30"), &settings())
                .fire
                .is_empty()
        );
    }

    #[test]
    fn recurring_completion_clears_fired() {
        // The command layer calls `forget_task` after every `complete_task`; a recurring task
        // then fires again on its next due date.
        let mut fired = Fired::default();
        let key = ReminderKey {
            project: "p".into(),
            no: 1,
            code: "-0m".into(),
        };
        fired.mark(&key, dt("2026-10-13T09:00"));
        fired.forget_task("p", 1);
        assert!(fired.entries.is_empty());
    }

    #[test]
    fn missed_counts_only_what_passed_since_last_seen() {
        let old = task(1, "2026-10-10", Some((9, 0)), &["-0m"], 0);
        let older = task(2, "2026-10-01", Some((9, 0)), &["-0m"], 0);
        let now = dt("2026-10-13T09:00");
        let d = due_reminders(&[old, older], &Fired::default(), now, &settings());
        assert_eq!(d.missed.len(), 2);
        // Last ran on 10/05: only the 10/10 reminder passed while the app was stopped.
        let m = select_missed(d.missed.clone(), Some(dt("2026-10-05T18:00")), now);
        assert_eq!(m.iter().map(|i| i.no).collect::<Vec<_>>(), vec![1]);
        // First run: nothing older than 24 hours is summarized.
        assert!(select_missed(d.missed, None, now).is_empty());
    }

    #[test]
    fn reminders_of_one_task_group_into_one_notification() {
        let a = task(1, "2026-10-13", Some((9, 0)), &["-0m", "-10m"], 0);
        let b = task(2, "2026-10-13", Some((9, 0)), &["-0m"], 0);
        let d = due_reminders(
            &[a, b],
            &Fired::default(),
            dt("2026-10-13T09:00"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 3);
        let groups = group_by_task(&d.fire);
        assert_eq!(
            groups.iter().map(|(i, n)| (i.no, *n)).collect::<Vec<_>>(),
            vec![(1, 2), (2, 1)]
        );
        assert_eq!(
            notification_body(groups[0].0, 2),
            "p · 期限 10/13 9:00 · 他 1 件"
        );
        assert_eq!(notification_body(groups[1].0, 1), "p · 期限 10/13 9:00");
        let timeless = ReminderItem {
            due_time: None,
            ..groups[1].0.clone()
        };
        assert_eq!(notification_body(&timeless, 1), "p · 期限 10/13");
        let undated = ReminderItem {
            due: None,
            ..timeless
        };
        assert_eq!(notification_body(&undated, 1), "p");
    }
}
