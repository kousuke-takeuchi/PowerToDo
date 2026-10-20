//! Reminder firing (仕様 §4.3–4.5): every 30 seconds, find the reminders that are due, record
//! them in `fired.json`, show OS notifications and tell the UI (`reminder-fired`).
//!
//! The decisions are pure ([`due_reminders`], [`apply`], [`action_is_current`]); what touches
//! Tauri is in [`tick`] and [`on_action`], which are checked by hand.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::time::Duration as StdDuration;

use chrono::{Duration, Local, NaiveDateTime, TimeZone};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::{Action, ActionPerformed, ActionType, NotificationExt};

use crate::commands::{self, AppState};
use crate::domain::Task;
use crate::domain::reminders;
use crate::store::common_book::Settings;
pub use crate::store::fired::{Fired, ReminderItem, ReminderKey, ScheduledEntry};
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
/// A snoozed reminder is due at its snooze time instead of its own, but only while its own
/// time is the one it was snoozed at: after the due date moved, the new time fires.
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
            let Some(own) = reminders::fire_time(code, t.due, t.due_time, settings.notify_time)
            else {
                continue;
            };
            let at = fired.snooze_until(&key, own).unwrap_or(own);
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

/// iOS keeps at most 64 scheduled local notifications per app (spec 5).
pub const IOS_SCHEDULE_LIMIT: usize = 64;

/// A reminder to hand to the OS, with the id its notification gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Planned {
    pub id: i32,
    pub item: ReminderItem,
}

/// Future fire times of unfinished tasks (snoozes applied, already-fired ones left out), nearest
/// first, ties by (project, no, code), at most `limit`.
pub fn upcoming(
    tasks: &[Task],
    fired: &Fired,
    now: NaiveDateTime,
    settings: &Settings,
    limit: usize,
) -> Vec<Planned> {
    let mut items = Vec::new();
    for t in tasks.iter().filter(|t| t.progress < 100) {
        for code in &t.reminders {
            let key = ReminderKey {
                project: t.project.clone(),
                no: t.no,
                code: code.clone(),
            };
            let Some(own) = reminders::fire_time(code, t.due, t.due_time, settings.notify_time)
            else {
                continue;
            };
            let at = fired.snooze_until(&key, own).unwrap_or(own);
            if at <= now || fired.contains(&key, at) {
                continue;
            }
            items.push(ReminderItem {
                project: t.project.clone(),
                no: t.no,
                title: t.title.clone(),
                code: code.clone(),
                at,
                due: t.due,
                due_time: t.due_time,
            });
        }
    }
    items.sort_by(|a, b| (a.at, &a.project, a.no, &a.code).cmp(&(b.at, &b.project, b.no, &b.code)));
    items.truncate(limit);
    items
        .into_iter()
        .map(|item| Planned {
            id: notification_id(&ReminderKey::of(&item), item.at),
            item,
        })
        .collect()
}

/// Stable positive id from the reminder and its time (FNV-1a 32 bit, top bit cleared).
pub fn notification_id(key: &ReminderKey, at: NaiveDateTime) -> i32 {
    let mut h: u32 = 0x811c_9dc5;
    let mut feed = |bytes: &[u8]| {
        for b in bytes.iter().chain(&[0u8]) {
            h ^= u32::from(*b);
            h = h.wrapping_mul(0x0100_0193);
        }
    };
    feed(key.project.as_bytes());
    feed(&key.no.to_le_bytes());
    feed(key.code.as_bytes());
    feed(at.format("%Y-%m-%dT%H:%M:%S").to_string().as_bytes());
    (h & 0x7fff_ffff) as i32
}

/// Seconds since the Unix epoch of a local time (the earlier one in a DST overlap; `None` in a gap).
pub fn local_timestamp(at: NaiveDateTime) -> Option<i64> {
    timestamp_in(&Local, at)
}

fn timestamp_in<Tz: TimeZone>(tz: &Tz, at: NaiveDateTime) -> Option<i64> {
    tz.from_local_datetime(&at)
        .earliest()
        .map(|d| d.timestamp())
}

/// FNV-1a 32 bit over the title and body a scheduled notification shows.
fn content_hash(item: &ReminderItem) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in item
        .title
        .bytes()
        .chain(std::iter::once(0))
        .chain(notification_body(item, 1).bytes())
    {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// The app was away since the last look (no look yet, or a gap of more than two periods):
/// what the OS scheduled meanwhile has been delivered. Decided from the data, not from the order
/// of the resume event and the 30 s timer.
fn was_away(last_seen: Option<NaiveDateTime>, now: NaiveDateTime) -> bool {
    match last_seen {
        None => true,
        Some(t) => now - t > Duration::from_std(PERIOD * 2).unwrap_or(Duration::seconds(60)),
    }
}

#[cfg_attr(not(target_os = "ios"), allow(dead_code))] // iOS only; tested everywhere
fn scheduled_entries(plan: &[Planned]) -> Vec<ScheduledEntry> {
    plan.iter()
        .map(|p| ScheduledEntry {
            key: ReminderKey::of(&p.item),
            at: p.item.at,
            id: p.id,
            content: content_hash(&p.item),
        })
        .collect()
}

/// The OS already holds exactly `plan` (same ids at the same times, in order).
#[cfg_attr(not(target_os = "ios"), allow(dead_code))] // iOS only; tested everywhere
fn is_scheduled(scheduled: &[ScheduledEntry], plan: &[Planned]) -> bool {
    scheduled.len() == plan.len()
        && scheduled
            .iter()
            .zip(plan)
            .all(|(s, p)| s.id == p.id && s.at == p.item.at && s.content == content_hash(&p.item))
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

/// One OS notification to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationPlan {
    /// One task: the first of its reminders that fired and how many fired together. Has the
    /// buttons and the extras the actions need.
    Single { item: ReminderItem, count: usize },
    /// 「N 件のリマインダーがありました」: no buttons, a click only shows the window.
    Summary { count: usize },
}

/// What one look decided, for the part of [`tick`] that runs without locks.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// Empty when notifications are off in the settings.
    pub notify: Vec<NotificationPlan>,
    /// `reminder-fired` (sent even when notifications are off); also added to `pending`.
    pub emit: Vec<ReminderItem>,
}

/// One look at the tasks, applied to `fired` (pure apart from `fired`):
///
/// - due reminders (see [`due_reminders`]); missed ones count only after the base
///   ([`select_missed`]: `last_seen`, or 24 hours ago when there is none). Older ones are
///   dropped without a record.
/// - every reminder found is recorded before anything is shown (仕様 §7: no retry), added to
///   `pending` and emitted; `last_seen = now`.
/// - `startup` (the first look after launch, or after a data folder switch): records of tasks
///   that no longer exist are dropped, and 2 or more reminders become one summary notification
///   (仕様 §4.5); exactly 1 gets the normal notification.
/// - a regular look: one notification per task; reminders missed while the machine slept get
///   one summary.
pub fn apply(
    fired: &mut Fired,
    tasks: &[Task],
    settings: &Settings,
    now: NaiveDateTime,
    startup: bool,
) -> Outcome {
    let decision = due_reminders(tasks, fired, now, settings);
    let missed = select_missed(decision.missed, fired.last_seen, now);
    let fire = decision.fire;
    for item in fire.iter().chain(&missed) {
        fired.mark(&ReminderKey::of(item), item.at);
    }
    if startup {
        let existing: BTreeSet<(String, u32)> =
            tasks.iter().map(|t| (t.project.clone(), t.no)).collect();
        fired.retain_existing(&existing);
    }
    fired.last_seen = Some(now);

    let mut notify = Vec::new();
    if startup {
        let all: Vec<&ReminderItem> = fire.iter().chain(&missed).collect();
        match all.as_slice() {
            [] => {}
            [one] => notify.push(NotificationPlan::Single {
                item: (*one).clone(),
                count: 1,
            }),
            many => notify.push(NotificationPlan::Summary { count: many.len() }),
        }
    } else {
        for (item, count) in group_by_task(&fire) {
            notify.push(NotificationPlan::Single {
                item: item.clone(),
                count,
            });
        }
        if !missed.is_empty() {
            notify.push(NotificationPlan::Summary {
                count: missed.len(),
            });
        }
    }
    if !settings.notifications {
        notify.clear();
    }
    let emit: Vec<ReminderItem> = fire.into_iter().chain(missed).collect();
    fired.push_pending(emit.iter().cloned());
    Outcome { notify, emit }
}

/// The reminder a notification was about, from its extra payload
/// (`ActionPerformed::notification()` → `ActiveNotification::extra()`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionTarget {
    /// The data folder the reminder came from (`dataDir`).
    pub data_dir: String,
    pub key: ReminderKey,
    /// The fire time the notification was shown for, to the minute (`at`).
    pub at: NaiveDateTime,
}

/// Extra keys of a reminder notification.
const EXTRA_DATA_DIR: &str = "dataDir";
const EXTRA_PROJECT: &str = "project";
const EXTRA_NO: &str = "no";
const EXTRA_CODE: &str = "code";
const EXTRA_AT: &str = "at";
const AT_FORMAT: &str = "%Y-%m-%dT%H:%M";

/// Reads the extras set by [`notify`]; `None` when any is missing (the summary has none).
pub fn action_target(extra: &HashMap<String, Value>) -> Option<ActionTarget> {
    let text = |k: &str| extra.get(k).and_then(Value::as_str).map(str::to_string);
    Some(ActionTarget {
        data_dir: text(EXTRA_DATA_DIR)?,
        key: ReminderKey {
            project: text(EXTRA_PROJECT)?,
            no: reminder_no(extra.get(EXTRA_NO)?)?,
            code: text(EXTRA_CODE)?,
        },
        at: NaiveDateTime::parse_from_str(&text(EXTRA_AT)?, AT_FORMAT).ok()?,
    })
}

/// A 完了 / 後で button still means what it said: the notification is from the open data
/// folder, and the reminder is still recorded as fired at that time. Completing the task,
/// changing its date or reminders, or switching folders drops the record, so an old
/// notification left in the notification center cannot complete the next occurrence of a
/// recurring task.
pub fn action_is_current(fired: &Fired, current_dir: Option<&Path>, target: &ActionTarget) -> bool {
    let dir = Path::new(&target.data_dir);
    current_dir == Some(dir)
        && fired.data_dir.as_deref() == Some(dir)
        && fired.contains_minute(&target.key, target.at)
}

/// iOS notifications carry the task number as a string; a notification left in a desktop
/// notification center by an older version carries a number.
fn reminder_no(v: &Value) -> Option<u32> {
    match v {
        Value::String(s) => s.parse().ok(),
        other => u32::try_from(other.as_u64()?).ok(),
    }
}

/// The extra payload of a reminder notification. All strings: the iOS plugin decodes
/// `[String: String]` and drops the notification otherwise.
pub fn reminder_extras(item: &ReminderItem, data_dir: &str) -> Vec<(&'static str, String)> {
    vec![
        (EXTRA_DATA_DIR, data_dir.to_string()),
        (EXTRA_PROJECT, item.project.clone()),
        (EXTRA_NO, item.no.to_string()),
        (EXTRA_CODE, item.code.clone()),
        (EXTRA_AT, item.at.format(AT_FORMAT).to_string()),
    ]
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
///
/// 後で comes first: macOS folds two buttons into an "Options" menu, and a click on the menu
/// button itself is reported as the first action, which must be the harmless one.
pub fn register(app: &AppHandle) {
    let notification = app.notification();
    let reminder = ActionType::builder(ACTION_TYPE)
        .actions(vec![
            Action::builder(ACTION_SNOOZE, "後で (10 分)").build(),
            Action::builder(ACTION_DONE, "完了").build(),
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
        while !tick(&app, Look::Start) {
            tokio::time::sleep(STARTUP_POLL).await;
        }
        let mut interval = tokio::time::interval(PERIOD);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // The first tick completes at once; the start-up look just ran.
        interval.tick().await;
        loop {
            interval.tick().await;
            tick(&app, Look::Regular);
        }
    });
}

/// Why the scheduler looks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Look {
    /// The first look after launch (the start-up summary).
    Start,
    Regular,
    #[cfg_attr(not(mobile), allow(dead_code))]
    /// iOS: back from the background. The OS delivered what was scheduled meanwhile.
    Resumed,
}

/// iOS: the app came back to the front. Mark what the OS delivered while away, look at the
/// tasks and refresh the schedule.
#[cfg(mobile)]
pub fn on_resumed(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        tick(&app, Look::Resumed);
    });
}

/// iOS: going to the background. Corrects the schedule at once instead of waiting for the next
/// 30 s look (a task edited just before leaving).
#[cfg(mobile)]
pub fn on_suspended(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        tick(&app, Look::Regular);
    });
}

/// One look at the tasks. `false` when no data folder is open (nothing was done).
///
/// Lock order (see `commands`): the store lock is taken and released first (copying the tasks,
/// settings and data folder), then the `fired` lock alone. Notifications and events go out
/// with no lock held.
fn tick(app: &AppHandle, look: Look) -> bool {
    let startup = look == Look::Start;
    let state = app.state::<AppState>();
    let Some((tasks, settings, data_dir)) = state.reminder_inputs() else {
        return false;
    };
    let now = now();
    let outcome = {
        let mut fired = state.lock_fired();
        // Normally already bound by `app_state` / `set_data_dir`; a switch counts as a start.
        fired.bind(&data_dir);
        let switched = std::mem::take(&mut fired.rebound);
        // iOS: the OS delivered what was scheduled while the app was stopped or away.
        if cfg!(target_os = "ios") && (look != Look::Regular || was_away(fired.last_seen, now)) {
            fired.mark_passed_scheduled(now);
        }
        let outcome = apply(&mut fired, &tasks, &settings, now, startup || switched);
        if let Err(e) = fired.save(state.app_data_dir()) {
            eprintln!("could not write {}: {e}", Fired::FILE);
        }
        outcome
    };

    // iOS: the OS shows the notifications from the schedule; showing here too would double them.
    #[cfg(not(target_os = "ios"))]
    {
        let dir = data_dir.to_string_lossy();
        for plan in &outcome.notify {
            match plan {
                NotificationPlan::Single { item, count } => notify(app, item, *count, &dir),
                NotificationPlan::Summary { count } => notify_summary(app, *count),
            }
        }
    }
    if !outcome.emit.is_empty() {
        let _ = app.emit(
            "reminder-fired",
            ReminderFired {
                items: outcome.emit,
            },
        );
    }
    #[cfg(target_os = "ios")]
    reschedule(app);
    true
}

#[cfg(not(target_os = "ios"))]
fn notify(app: &AppHandle, item: &ReminderItem, count: usize, data_dir: &str) {
    let mut builder = app
        .notification()
        .builder()
        .title(item.title.clone())
        .body(notification_body(item, count))
        .action_type_id(ACTION_TYPE);
    for (k, v) in reminder_extras(item, data_dir) {
        builder = builder.extra(k, v);
    }
    let shown = builder.show();
    if let Err(e) = shown {
        eprintln!(
            "could not show the reminder for {}#{}: {e}",
            item.project, item.no
        );
    }
}

/// The summary (仕様 §4.5). A click only brings the window back; the banner lists them.
#[cfg(not(target_os = "ios"))]
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

/// iOS: keeps the OS's scheduled notifications equal to the nearest [`IOS_SCHEDULE_LIMIT`]
/// upcoming reminders. Nothing happens when `fired.scheduled` already matches; otherwise the
/// previous ids are cancelled and the new ones registered. Permission is asked for the first
/// time something is to be scheduled; when denied nothing is registered.
#[cfg(target_os = "ios")]
pub fn reschedule(app: &AppHandle) {
    // One reschedule at a time (the 30 s look and the move to the background can overlap).
    static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());

    let state = app.state::<AppState>();
    let Some((tasks, settings, data_dir)) = state.reminder_inputs() else {
        return;
    };
    reschedule_with(app, &tasks, &settings, &data_dir);
}

#[cfg(target_os = "ios")]
fn reschedule_with(app: &AppHandle, tasks: &[Task], settings: &Settings, data_dir: &Path) {
    use tauri_plugin_notification::{PermissionState, Schedule};

    let state = app.state::<AppState>();
    let now = now();
    let (plan, old_ids) = {
        let fired = state.lock_fired();
        let plan = if settings.notifications {
            upcoming(tasks, &fired, now, settings, IOS_SCHEDULE_LIMIT)
        } else {
            Vec::new()
        };
        if is_scheduled(&fired.scheduled, &plan) {
            return;
        }
        (
            plan,
            fired.scheduled.iter().map(|s| s.id).collect::<Vec<_>>(),
        )
    };

    let notification = app.notification();
    if !plan.is_empty() {
        let mut permission = notification.permission_state();
        if matches!(
            permission,
            Ok(PermissionState::Prompt | PermissionState::PromptWithRationale)
        ) {
            permission = notification.request_permission();
        }
        if !matches!(permission, Ok(PermissionState::Granted)) {
            // Denied (or unknown): nothing to register. The settings screen explains.
            return;
        }
    }
    if !old_ids.is_empty()
        && let Err(e) = notification.cancel(old_ids)
    {
        eprintln!("could not cancel the scheduled reminders: {e}");
    }
    let dir = data_dir.to_string_lossy();
    let mut done = Vec::new();
    for p in &plan {
        let Some(ts) = local_timestamp(p.item.at) else {
            continue;
        };
        let Ok(date) = time::OffsetDateTime::from_unix_timestamp(ts) else {
            continue;
        };
        let mut builder = notification
            .builder()
            .id(p.id)
            .title(p.item.title.clone())
            .body(notification_body(&p.item, 1))
            .action_type_id(ACTION_TYPE)
            .schedule(Schedule::At {
                date,
                repeating: false,
                allow_while_idle: false,
            });
        for (k, v) in reminder_extras(&p.item, &dir) {
            builder = builder.extra(k, v);
        }
        match builder.show() {
            Ok(()) => done.push(p.clone()),
            Err(e) => eprintln!(
                "could not schedule the reminder for {}#{}: {e}",
                p.item.project, p.item.no
            ),
        }
    }
    let mut fired = state.lock_fired();
    fired.scheduled = scheduled_entries(&done);
    if let Err(e) = fired.save(state.app_data_dir()) {
        eprintln!("could not write {}: {e}", Fired::FILE);
    }
}

/// What the user did with a notification. Runs on the plugin's notification thread: the work
/// goes to the async runtime (the saver needs it) and this returns at once.
fn on_action(app: &AppHandle, performed: &ActionPerformed) {
    let action = performed.action_id().to_string();
    let target = performed
        .notification()
        .and_then(|n| action_target(n.extra()));
    let app = app.clone();
    tauri::async_runtime::spawn(async move { act(&app, &action, target) });
}

/// 完了 / 後で act only on a current reminder ([`action_is_current`]); a stale button, like a
/// click on the notification, shows the window and opens the task. Notifications of another
/// data folder (and the summary) only show the window.
fn act(app: &AppHandle, action: &str, target: Option<ActionTarget>) {
    let state = app.state::<AppState>();
    // Store lock, released; then the `fired` lock alone.
    let current_dir = state.current_data_dir();
    let Some(target) = target.filter(|t| current_dir.as_deref() == Some(Path::new(&t.data_dir)))
    else {
        window::show_main_window(app);
        return;
    };
    let current = action_is_current(&state.lock_fired(), current_dir.as_deref(), &target);
    match action {
        ACTION_DONE if current => {
            commands::complete_from_notification(app, &target.key.project, target.key.no);
        }
        ACTION_SNOOZE if current => {
            state.snooze_fired(&target.key, now() + Duration::minutes(SNOOZE_MINUTES));
        }
        _ => {
            window::show_main_window(app);
            let _ = app.emit(
                "open-task",
                OpenTask {
                    project: target.key.project,
                    no: target.key.no,
                },
            );
        }
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
        fired.snooze(&key, Some(dt("2026-10-13T09:00")), dt("2026-10-13T09:10"));
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
    fn a_snooze_does_not_outlive_a_due_date_change() {
        // Snoozed at 10/13 15:00, then 「期限切れを今日に」 (or Excel) moves the due date to
        // 10/14 without forgetting the records: the 10/14 15:00 reminder still fires.
        let t = task(1, "2026-10-13", Some((15, 0)), &["-0m"], 0);
        let mut fired = Fired::default();
        let d = due_reminders(
            std::slice::from_ref(&t),
            &fired,
            dt("2026-10-13T15:00"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 1);
        let key = ReminderKey::of(&d.fire[0]);
        fired.mark(&key, d.fire[0].at);
        fired.snooze(&key, Some(dt("2026-10-13T15:00")), dt("2026-10-13T15:10"));
        // The snoozed firing comes and is recorded.
        let d = due_reminders(
            std::slice::from_ref(&t),
            &fired,
            dt("2026-10-13T15:10"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 1);
        fired.mark(&key, d.fire[0].at);

        let moved = task(1, "2026-10-14", Some((15, 0)), &["-0m"], 0);
        let d = due_reminders(
            std::slice::from_ref(&moved),
            &fired,
            dt("2026-10-14T15:00"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 1);
        assert_eq!(d.fire[0].at, dt("2026-10-14T15:00"));
    }

    #[test]
    fn snoozing_a_stale_reminder_does_not_swallow_the_next_one() {
        // The 10/13 15:00 reminder fired; the due date then moved to 10/14 15:00 (Excel, or the
        // task was completed and advanced) and an old banner row / notification is snoozed at
        // 10/13 16:00. The snooze must not bind to the future 10/14 15:00 fire time.
        let mut fired = Fired::default();
        let key = ReminderKey {
            project: "p".into(),
            no: 1,
            code: "-0m".into(),
        };
        fired.mark(&key, dt("2026-10-13T15:00"));
        let moved = task(1, "2026-10-14", Some((15, 0)), &["-0m"], 0);
        let now = dt("2026-10-13T16:00");
        let bound = Fired::snooze_binding(Some(dt("2026-10-14T15:00")), now);
        assert_eq!(bound, None);
        fired.snooze(&key, bound, dt("2026-10-13T16:10"));
        // The snooze time passes without a firing for the moved task...
        let d = due_reminders(
            std::slice::from_ref(&moved),
            &fired,
            dt("2026-10-13T16:10"),
            &settings(),
        );
        assert!(d.fire.is_empty());
        // ...and the new due time still rings.
        let d = due_reminders(
            std::slice::from_ref(&moved),
            &fired,
            dt("2026-10-14T15:00"),
            &settings(),
        );
        assert_eq!(d.fire.len(), 1);
        assert_eq!(d.fire[0].at, dt("2026-10-14T15:00"));
        // A fire time that has come is still bound.
        assert_eq!(
            Fired::snooze_binding(Some(dt("2026-10-13T15:00")), now),
            Some(dt("2026-10-13T15:00"))
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

    fn plans(o: &Outcome) -> Vec<String> {
        o.notify
            .iter()
            .map(|p| match p {
                NotificationPlan::Single { item, count } => format!("single {}x{count}", item.no),
                NotificationPlan::Summary { count } => format!("summary {count}"),
            })
            .collect()
    }

    #[test]
    fn startup_with_several_reminders_shows_one_summary() {
        let tasks = [
            task(1, "2026-10-13", Some((8, 0)), &["-0m"], 0),
            task(2, "2026-10-13", Some((8, 30)), &["-0m"], 0),
            task(3, "2026-10-11", Some((9, 0)), &["-0m"], 0), // missed while stopped
        ];
        let mut fired = Fired {
            last_seen: Some(dt("2026-10-10T18:00")),
            ..Fired::default()
        };
        let now = dt("2026-10-13T09:00");
        let o = apply(&mut fired, &tasks, &settings(), now, true);
        assert_eq!(plans(&o), vec!["summary 3"]);
        assert_eq!(
            o.emit.iter().map(|i| i.no).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(fired.pending, o.emit);
        assert_eq!(fired.entries.len(), 3);
        assert_eq!(fired.last_seen, Some(now));
        // Recorded: the next look is quiet.
        let o = apply(
            &mut fired,
            &tasks,
            &settings(),
            dt("2026-10-13T09:00:30"),
            false,
        );
        assert_eq!(o, Outcome::default());
    }

    #[test]
    fn startup_with_one_reminder_shows_it_normally() {
        let tasks = [task(1, "2026-10-13", Some((8, 0)), &["-0m"], 0)];
        let mut fired = Fired {
            last_seen: Some(dt("2026-10-13T07:00")),
            ..Fired::default()
        };
        let o = apply(
            &mut fired,
            &tasks,
            &settings(),
            dt("2026-10-13T09:00"),
            true,
        );
        assert_eq!(plans(&o), vec!["single 1x1"]);
    }

    #[test]
    fn regular_look_notifies_per_task() {
        let tasks = [
            task(1, "2026-10-13", Some((9, 0)), &["-0m", "-10m"], 0),
            task(2, "2026-10-13", Some((9, 0)), &["-0m"], 0),
        ];
        let mut fired = Fired {
            last_seen: Some(dt("2026-10-13T08:59:30")),
            ..Fired::default()
        };
        let o = apply(
            &mut fired,
            &tasks,
            &settings(),
            dt("2026-10-13T09:00"),
            false,
        );
        assert_eq!(plans(&o), vec!["single 1x2", "single 2x1"]);
        assert_eq!(o.emit.len(), 3);
        // Notifications off: nothing shown, still emitted and pending.
        let mut quiet = Fired::default();
        let off = Settings {
            notifications: false,
            ..settings()
        };
        let o = apply(&mut quiet, &tasks, &off, dt("2026-10-13T09:00"), false);
        assert!(o.notify.is_empty());
        assert_eq!(o.emit.len(), 3);
        assert_eq!(quiet.pending.len(), 3);
    }

    #[test]
    fn without_last_seen_the_base_is_24_hours_ago() {
        // First run, or a corrupt fired.json: only the last 24 hours count.
        let tasks = [
            task(1, "2026-10-10", Some((9, 0)), &["-0m"], 0),
            task(2, "2026-10-13", Some((8, 0)), &["-0m"], 0),
        ];
        let mut fired = Fired::default();
        let o = apply(
            &mut fired,
            &tasks,
            &settings(),
            dt("2026-10-13T09:00"),
            true,
        );
        assert_eq!(plans(&o), vec!["single 2x1"]);
        assert_eq!(o.emit.iter().map(|i| i.no).collect::<Vec<_>>(), vec![2]);
        // The old one is dropped without a record.
        assert_eq!(fired.entries.len(), 1);
    }

    #[test]
    fn startup_drops_records_of_vanished_tasks() {
        let mut fired = Fired::default();
        fired.mark(
            &ReminderKey {
                project: "gone".into(),
                no: 9,
                code: "-0m".into(),
            },
            dt("2026-10-13T08:00"),
        );
        let tasks = [task(1, "2026-10-20", Some((9, 0)), &["-0m"], 0)];
        apply(
            &mut fired,
            &tasks,
            &settings(),
            dt("2026-10-13T09:00"),
            false,
        );
        assert_eq!(fired.entries.len(), 1);
        apply(
            &mut fired,
            &tasks,
            &settings(),
            dt("2026-10-13T09:00"),
            true,
        );
        assert!(fired.entries.is_empty());
    }

    fn extras(dir: &str, at: &str) -> HashMap<String, Value> {
        HashMap::from([
            ("dataDir".to_string(), Value::from(dir)),
            ("project".to_string(), Value::from("p")),
            ("no".to_string(), Value::from(1)),
            ("code".to_string(), Value::from("-0m")),
            ("at".to_string(), Value::from(at)),
        ])
    }

    #[test]
    fn notification_extras_are_read_back() {
        let t = action_target(&extras("/data", "2026-10-13T09:00")).unwrap();
        assert_eq!(t.data_dir, "/data");
        assert_eq!(
            t.key,
            ReminderKey {
                project: "p".into(),
                no: 1,
                code: "-0m".into()
            }
        );
        assert_eq!(t.at, dt("2026-10-13T09:00"));
        let mut partial = extras("/data", "2026-10-13T09:00");
        partial.remove("at");
        assert_eq!(action_target(&partial), None);
        assert_eq!(action_target(&HashMap::new()), None);
    }

    #[test]
    fn only_a_current_reminder_can_be_completed_or_snoozed() {
        let dir = Path::new("/data");
        let t = action_target(&extras("/data", "2026-10-13T09:00")).unwrap();
        let mut fired = Fired::default();
        fired.bind(dir);
        // Not recorded (completed, edited, or never fired here): stale.
        assert!(!action_is_current(&fired, Some(dir), &t));
        fired.mark(&t.key, dt("2026-10-13T09:00"));
        assert!(action_is_current(&fired, Some(dir), &t));
        // Another folder is open, or the records belong to another folder.
        assert!(!action_is_current(&fired, Some(Path::new("/other")), &t));
        assert!(!action_is_current(&fired, None, &t));
        let mut other = fired.clone();
        other.bind(Path::new("/other"));
        assert!(!action_is_current(&other, Some(dir), &t));
        // A recurring task completed in the app: its records are forgotten, the old
        // notification no longer completes the next occurrence.
        fired.forget_task("p", 1);
        assert!(!action_is_current(&fired, Some(dir), &t));
        // A snoozed firing (seconds in the record) matches its notification to the minute.
        fired.mark(&t.key, dt("2026-10-13T09:10:42"));
        let snoozed = action_target(&extras("/data", "2026-10-13T09:10")).unwrap();
        assert!(action_is_current(&fired, Some(dir), &snoozed));
    }

    fn upcoming_at(tasks: &[Task], fired: &Fired, limit: usize) -> Vec<Planned> {
        upcoming(tasks, fired, dt("2026-10-13T08:00"), &settings(), limit)
    }

    #[test]
    fn upcoming_is_nearest_first_and_capped() {
        let tasks: Vec<Task> = (1..=70)
            .map(|n| {
                // Later tasks are due earlier, so the order has to come from the sort.
                let day = 28 - (n % 28);
                task(n, &format!("2026-11-{day:02}"), Some((10, 0)), &["-0m"], 0)
            })
            .collect();
        let plan = upcoming_at(&tasks, &Fired::default(), IOS_SCHEDULE_LIMIT);
        assert_eq!(plan.len(), 64);
        assert!(plan.windows(2).all(|w| w[0].item.at <= w[1].item.at));
        // The 6 latest are the ones left out.
        let latest = tasks.iter().map(|t| t.due).max().unwrap().unwrap();
        assert!(plan.iter().all(|p| p.item.at.date() <= latest));
        let all = upcoming_at(&tasks, &Fired::default(), 1000);
        assert_eq!(&all[..64], &plan[..]);
    }

    #[test]
    fn upcoming_skips_past_done_and_fired() {
        let past = task(1, "2026-10-12", Some((10, 0)), &["-0m"], 0);
        let done = task(2, "2026-10-14", Some((10, 0)), &["-0m"], 100);
        let fired_t = task(3, "2026-10-14", Some((10, 0)), &["-0m"], 0);
        let next = task(4, "2026-10-14", Some((10, 0)), &["-0m"], 0);
        let mut fired = Fired::default();
        fired.mark(
            &ReminderKey {
                project: "p".into(),
                no: 3,
                code: "-0m".into(),
            },
            dt("2026-10-14T10:00"),
        );
        let plan = upcoming_at(&[past, done, fired_t, next], &fired, 64);
        assert_eq!(plan.iter().map(|p| p.item.no).collect::<Vec<_>>(), vec![4]);
    }

    #[test]
    fn upcoming_uses_the_snooze_time() {
        let t = task(1, "2026-10-13", Some((7, 0)), &["-0m"], 0);
        let key = ReminderKey {
            project: "p".into(),
            no: 1,
            code: "-0m".into(),
        };
        let mut fired = Fired::default();
        fired.snooze(
            &key,
            Some(dt("2026-10-13T07:00")),
            dt("2026-10-13T08:30:15"),
        );
        let plan = upcoming_at(&[t], &fired, 64);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].item.at, dt("2026-10-13T08:30:15"));
    }

    #[test]
    fn upcoming_ties_are_ordered_by_project_no_code() {
        let mut a = task(2, "2026-10-14", Some((10, 0)), &["-0m"], 0);
        a.project = "b".into();
        let b = task(5, "2026-10-14", Some((10, 0)), &["-0m"], 0);
        let c = task(3, "2026-10-14", Some((10, 0)), &["-0m"], 0);
        let d = task(3, "2026-10-14", Some((10, 30)), &["-30m", "-0m"], 0);
        let plan = upcoming_at(&[a, b, c, d], &Fired::default(), 64);
        let order: Vec<_> = plan
            .iter()
            .map(|p| (p.item.project.as_str(), p.item.no, p.item.code.as_str()))
            .collect();
        assert_eq!(
            order,
            vec![
                ("b", 2, "-0m"),
                ("p", 3, "-0m"),
                ("p", 3, "-30m"),
                ("p", 5, "-0m"),
                ("p", 3, "-0m"),
            ]
        );
    }

    #[test]
    fn notification_id_is_stable_and_positive() {
        let k = |p: &str, no, c: &str| ReminderKey {
            project: p.into(),
            no,
            code: c.into(),
        };
        let at = dt("2026-10-14T10:00");
        let id = notification_id(&k("p", 1, "-0m"), at);
        assert_eq!(id, notification_id(&k("p", 1, "-0m"), at));
        assert!(id >= 0);
        let others = [
            notification_id(&k("q", 1, "-0m"), at),
            notification_id(&k("p", 2, "-0m"), at),
            notification_id(&k("p", 1, "-30m"), at),
            notification_id(&k("p", 1, "-0m"), dt("2026-10-14T10:01")),
        ];
        for o in others {
            assert!(o >= 0);
            assert_ne!(o, id);
        }
    }

    #[test]
    fn local_timestamp_handles_a_normal_time() {
        let jst = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
        // 2026-10-14 09:00 JST = 2026-10-14 00:00 UTC
        let utc_midnight = dt("2026-10-14T00:00");
        assert_eq!(
            timestamp_in(&jst, dt("2026-10-14T09:00")),
            Some(utc_midnight.and_utc().timestamp())
        );
    }

    #[test]
    fn local_timestamp_picks_the_earlier_time_in_a_dst_overlap_and_none_in_a_gap() {
        use chrono::TimeZone;
        // America/New_York has no fixed offset; build a tz-like check with chrono's Local only
        // when the machine zone has the rule, else skip. The generic function is what matters:
        // a FixedOffset never has gaps or overlaps, so just check `earliest` is used.
        let utc = chrono::Utc;
        assert_eq!(
            timestamp_in(&utc, dt("2026-10-14T00:00")),
            Some(
                utc.with_ymd_and_hms(2026, 10, 14, 0, 0, 0)
                    .unwrap()
                    .timestamp()
            )
        );
    }

    #[test]
    fn notification_extras_are_all_strings() {
        let it = ReminderItem {
            project: "p".into(),
            no: 12,
            title: "t".into(),
            code: "-0m".into(),
            at: dt("2026-10-13T09:00"),
            due: None,
            due_time: None,
        };
        let extras = reminder_extras(&it, "/data");
        let keys: Vec<_> = extras.iter().map(|(k, _)| *k).collect();
        assert_eq!(keys, vec!["dataDir", "project", "no", "code", "at"]);
        // The iOS side decodes `[String: String]`: build the payload the way the plugin does.
        let mut map = serde_json::Map::new();
        for (k, v) in &extras {
            map.insert(k.to_string(), serde_json::to_value(v).unwrap());
        }
        assert!(map.values().all(Value::is_string));
        assert_eq!(map["no"], "12");
        let back: HashMap<String, Value> = map.into_iter().collect();
        assert_eq!(action_target(&back).unwrap().key.no, 12);
    }

    #[test]
    fn action_target_reads_a_string_no() {
        let mut e = extras("/data", "2026-10-13T09:00");
        e.insert("no".into(), Value::from("7"));
        assert_eq!(action_target(&e).unwrap().key.no, 7);
        e.insert("no".into(), Value::from("x"));
        assert_eq!(action_target(&e), None);
    }

    #[test]
    fn action_target_reads_a_numeric_no() {
        let mut e = extras("/data", "2026-10-13T09:00");
        e.insert("no".into(), Value::from(7));
        assert_eq!(action_target(&e).unwrap().key.no, 7);
    }

    #[test]
    fn a_gap_since_the_last_look_means_the_app_was_away() {
        let now = dt("2026-10-13T09:10");
        assert!(was_away(None, now));
        assert!(!was_away(Some(now - Duration::seconds(30)), now));
        assert!(!was_away(Some(now - Duration::seconds(60)), now));
        assert!(was_away(Some(now - Duration::seconds(61)), now));
        assert!(was_away(Some(now - Duration::hours(3)), now));
    }

    #[test]
    fn an_edited_title_needs_a_new_schedule() {
        let at = dt("2026-10-14T10:00");
        let mk = |title: &str, due: Option<NaiveDate>| Planned {
            id: 5,
            item: ReminderItem {
                project: "p".into(),
                no: 1,
                title: title.into(),
                code: "-0m".into(),
                at,
                due,
                due_time: None,
            },
        };
        let before = vec![mk("old", None)];
        let entries = scheduled_entries(&before);
        assert!(is_scheduled(&entries, &before));
        assert!(!is_scheduled(&entries, &[mk("new", None)]));
        let d = NaiveDate::from_ymd_opt(2026, 10, 14);
        assert!(!is_scheduled(&entries, &[mk("old", d)]));
    }

    #[test]
    fn an_unchanged_plan_needs_no_new_schedule() {
        let p = |no: u32, at: &str| Planned {
            id: notification_id(
                &ReminderKey {
                    project: "p".into(),
                    no,
                    code: "-0m".into(),
                },
                dt(at),
            ),
            item: ReminderItem {
                project: "p".into(),
                no,
                title: "t".into(),
                code: "-0m".into(),
                at: dt(at),
                due: None,
                due_time: None,
            },
        };
        let plan = vec![p(1, "2026-10-14T10:00"), p(2, "2026-10-14T11:00")];
        let entries = scheduled_entries(&plan);
        assert!(is_scheduled(&entries, &plan));
        assert!(!is_scheduled(&entries[..1], &plan));
        assert!(!is_scheduled(&entries, &plan[..1]));
        let moved = vec![p(1, "2026-10-14T10:05"), p(2, "2026-10-14T11:00")];
        assert!(!is_scheduled(&entries, &moved));
        assert!(is_scheduled(&[], &[]));
    }
}
