//! Google Calendar import (spec 2026-11-27): accounts, which calendar a project shows, and the events.
//! Read-only. The accounts and the last fetch are per device (`calendar.json`); the refresh token of each account is in
//! the OS keychain (service `app.powertodo.gcal`, account = the e-mail address), never in a file.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{DateTime, FixedOffset, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[cfg(not(target_os = "ios"))]
use super::sync::guarded_opener;
use super::sync::{blocking, oauth_error, production_oauth, revoke_unused};
use super::{AppState, mutate, with_store};
use crate::calendar::file::{CalendarFile, is_fresh};
use crate::calendar::http::{CalError, CalendarApi};
use crate::calendar::{CalEvent, CalendarInfo};
use crate::error::{AppError, AppResult};
use crate::store::calendar_link::CalendarLink;
use crate::sync::oauth::{CALENDAR_SCOPE, OAuthError, TokenSource};

/// Service name of the calendar accounts' refresh tokens.
pub const CALENDAR_SERVICE: &str = "app.powertodo.gcal";

const NOT_GRANTED: &str = "カレンダーの読み取りが許可されませんでした。もう一度ログインし、カレンダーの閲覧にチェックを入れてください";
const NO_ADDRESS: &str =
    "Google のアカウントのメールアドレスを読めませんでした。もう一度ログインしてください";

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One writer of `calendar.json` at a time (read, change, write).
static FILE_LOCK: Mutex<()> = Mutex::new(());
/// The token source of each account: kept so an access token is reused until it expires.
static SOURCES: Mutex<Option<HashMap<String, Arc<TokenSource>>>> = Mutex::new(None);

fn source_for(account: &str) -> Option<Arc<TokenSource>> {
    lock(&SOURCES)
        .as_ref()
        .and_then(|m| m.get(account).cloned())
}

fn put_source(account: &str, source: Arc<TokenSource>) {
    lock(&SOURCES)
        .get_or_insert_with(HashMap::new)
        .insert(account.to_string(), source);
}

fn drop_source(account: &str) {
    if let Some(m) = lock(&SOURCES).as_mut() {
        m.remove(account);
    }
}

/// Updates the device file under the lock.
fn update_file<R>(
    app_data_dir: &std::path::Path,
    f: impl FnOnce(&mut CalendarFile) -> R,
) -> AppResult<R> {
    let _guard = lock_file();
    let mut file = CalendarFile::load(app_data_dir);
    let out = f(&mut file);
    file.save(app_data_dir)?;
    Ok(out)
}

fn lock_file() -> MutexGuard<'static, ()> {
    lock(&FILE_LOCK)
}

/// The token source of a logged-in account, or `None` when this device has no token for it.
async fn token_source(app: &AppHandle, account: &str) -> AppResult<Option<Arc<TokenSource>>> {
    if let Some(s) = source_for(account) {
        return Ok(Some(s));
    }
    let secrets = app.state::<AppState>().sync_rt.secrets();
    let a = account.to_string();
    let Some(token) = blocking(move || secrets.get(CALENDAR_SERVICE, &a)).await? else {
        return Ok(None);
    };
    let oauth = production_oauth()?.with_scope(CALENDAR_SCOPE);
    let source = Arc::new(TokenSource::new(oauth, token));
    put_source(account, Arc::clone(&source));
    Ok(Some(source))
}

fn api_error(e: CalError) -> AppError {
    match e {
        CalError::Offline(message) => AppError::Io { message },
        other => AppError::Invalid {
            message: other.to_string(),
        },
    }
}

fn to_local(d: DateTime<FixedOffset>) -> NaiveDateTime {
    d.with_timezone(&Local).naive_local()
}

/// `00:00` of `day` in this device's time zone, as RFC 3339 (what Google's `timeMin` / `timeMax` take).
fn midnight(day: NaiveDate) -> String {
    let t = day.and_hms_opt(0, 0, 0).unwrap_or_default();
    Local
        .from_local_datetime(&t)
        .earliest()
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| Utc.from_utc_datetime(&t).to_rfc3339())
}

// ---- accounts ----

#[tauri::command]
pub async fn calendar_accounts(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(CalendarFile::load(state.app_data_dir()).accounts)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarLoginDto {
    /// `done`, `cancelled` or `denied`. The last two are not failures.
    pub outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// 「アカウントを追加」: the Google login for the calendar scope. It shares the one login place with the Drive login
/// (`google_login_cancel` cancels it too). The account is kept only when the user granted calendar reading.
#[tauri::command]
pub async fn calendar_login(app: AppHandle) -> AppResult<CalendarLoginDto> {
    let oauth = production_oauth()?.with_scope(CALENDAR_SCOPE);
    let state = app.state::<AppState>();
    let Some(slot) = state.sync_rt.begin_login() else {
        return Err(AppError::Invalid {
            message: "ログインの途中です。開いたブラウザで続けるか、「キャンセル」を押してください"
                .into(),
        });
    };
    let cancel = Arc::clone(&slot.cancel);
    #[cfg(target_os = "ios")]
    let result = {
        let redirect = crate::sync::oauth::ios_client_id()
            .and_then(crate::sync::oauth::ios_redirect_uri)
            .ok_or_else(|| AppError::Invalid {
                message: "このビルドでは Google にログインできません".into(),
            })?;
        let scheme = redirect.split(':').next().unwrap_or_default().to_string();
        let sheet_app = app.clone();
        oauth
            .login_with_redirect(
                &redirect,
                move |url| super::sync::present_login_sheet(sheet_app, url, scheme),
                async move { cancel.notified().await },
            )
            .await
    };
    #[cfg(not(target_os = "ios"))]
    let result = {
        let failure = Arc::new(Mutex::new(None));
        let opener_app = app.clone();
        let open = guarded_opener(Arc::clone(&cancel), Arc::clone(&failure), move |url| {
            crate::platform::open_url(&opener_app, url)
                .map_err(|_| "ブラウザを開けませんでした".to_string())
        });
        let result = oauth
            .login(open, async move { cancel.notified().await })
            .await;
        if let Some(message) = lock(&failure).take() {
            drop(slot);
            return Err(AppError::Io { message });
        }
        result
    };
    drop(slot);
    let tokens = match result {
        Ok(t) => t,
        Err(OAuthError::Cancelled) => {
            return Ok(CalendarLoginDto {
                outcome: "cancelled",
                email: None,
            });
        }
        Err(OAuthError::Denied) => {
            return Ok(CalendarLoginDto {
                outcome: "denied",
                email: None,
            });
        }
        Err(e) => return Err(oauth_error(e)),
    };
    if !tokens.grants_calendar() {
        revoke_unused(&oauth, &tokens.refresh_token).await;
        return Err(AppError::Invalid {
            message: NOT_GRANTED.into(),
        });
    }
    let Some(email) = tokens.email.clone() else {
        revoke_unused(&oauth, &tokens.refresh_token).await;
        return Err(AppError::Invalid {
            message: NO_ADDRESS.into(),
        });
    };
    let secrets = state.sync_rt.secrets();
    let (a, t) = (email.clone(), tokens.refresh_token.clone());
    blocking(move || secrets.set(CALENDAR_SERVICE, &a, &t)).await?;
    put_source(
        &email,
        Arc::new(TokenSource::new(
            oauth.clone(),
            tokens.refresh_token.clone(),
        )),
    );
    let e = email.clone();
    update_file(state.app_data_dir(), move |f| f.add_account(&e))?;
    Ok(CalendarLoginDto {
        outcome: "done",
        email: Some(email),
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarLogoutDto {
    /// Google was told to forget the login (false: offline; the token is gone from this device all the same).
    pub revoked: bool,
}

/// 「ログアウト」 of one calendar account: Google forgets the login, the token leaves the keychain, the account and its
/// fetched events leave this device. A project that used it keeps its setting and shows 「ログインが必要です」.
#[tauri::command]
pub async fn calendar_logout(email: String, app: AppHandle) -> AppResult<CalendarLogoutDto> {
    let state = app.state::<AppState>();
    let secrets = state.sync_rt.secrets();
    let (s, a) = (Arc::clone(&secrets), email.clone());
    let token = blocking(move || s.get_fresh(CALENDAR_SERVICE, &a)).await?;
    let mut revoked = true;
    if let Some(token) = &token {
        revoked = match production_oauth() {
            Ok(oauth) => oauth.revoke(token).await.is_ok(),
            Err(_) => false,
        };
    }
    let a = email.clone();
    blocking(move || {
        let _ = secrets.delete(CALENDAR_SERVICE, &a);
    })
    .await?;
    drop_source(&email);
    let e = email.clone();
    update_file(state.app_data_dir(), move |f| f.remove_account(&e))?;
    Ok(CalendarLogoutDto { revoked })
}

/// The calendars an account can read (the chooser of a project).
#[tauri::command]
pub async fn calendar_calendars(email: String, app: AppHandle) -> AppResult<Vec<CalendarInfo>> {
    let Some(source) = token_source(&app, &email).await? else {
        return Err(AppError::Invalid {
            message: "このアカウントにはこの端末でログインしていません".into(),
        });
    };
    CalendarApi::production()
        .map_err(api_error)?
        .calendars(&source)
        .await
        .map_err(api_error)
}

// ---- projects ----

#[tauri::command]
pub async fn calendar_links(
    state: State<'_, AppState>,
) -> AppResult<BTreeMap<String, Vec<CalendarLink>>> {
    with_store(state.inner(), |s| Ok(s.calendar_links()))
}

/// Chooses the calendars a project shows (several, of several accounts); an empty list takes them all off.
#[tauri::command]
pub async fn calendar_set_links(
    project: String,
    links: Vec<CalendarLink>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    mutate(&app, state.inner(), &[], true, |s| {
        s.set_calendar_links(&project, &links)
    })
}

// ---- events ----

/// An event with the calendar it comes from (its color and name), for the rows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedEvent {
    #[serde(flatten)]
    pub event: CalEvent,
    pub color: String,
    pub calendar: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEvents {
    /// The events of all the project's calendars, by date, then all-day first, then by start time.
    pub events: Vec<PlacedEvent>,
    /// This device is not logged in to the account of one of the calendars: the project says 「ログインが必要です」.
    pub needs_login: bool,
    /// Why the last fetch of a calendar failed (the events shown are the earlier ones, or none).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The events of `[from, to]` (`YYYY-MM-DD`) of every project that has calendars. A calendar fetched less than five
/// minutes ago is not fetched again unless `force`; an account that fails fails only its own calendars.
#[tauri::command]
pub async fn calendar_events(
    from: String,
    to: String,
    force: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<BTreeMap<String, ProjectEvents>> {
    let parse = |s: &str| {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::Invalid {
            message: format!("日付が正しくありません: {s}"),
        })
    };
    let (from, to) = (parse(&from)?, parse(&to)?);
    let links = with_store(state.inner(), |s| Ok(s.calendar_links()))?;
    let dir = state.app_data_dir().to_path_buf();
    let mut file = CalendarFile::load(&dir);
    let now = Utc::now().timestamp();
    let api = CalendarApi::production().map_err(api_error)?;
    // One fetch per (account, calendar), however many projects share it.
    let mut errors: BTreeMap<(String, String), String> = BTreeMap::new();
    let mut fetched_any = false;
    for link in links.values().flatten() {
        let key = (link.account.clone(), link.calendar_id.clone());
        if errors.contains_key(&key) || !file.accounts.contains(&link.account) {
            continue;
        }
        if !force && is_fresh(file.get(&link.account, &link.calendar_id), now) {
            continue;
        }
        let Some(source) = token_source(&app, &link.account).await? else {
            continue;
        };
        match api
            .events(
                &source,
                &link.calendar_id,
                &midnight(from),
                &midnight(to + chrono::Duration::days(1)),
                to_local,
            )
            .await
        {
            Ok(events) => {
                file.put(&link.account, &link.calendar_id, now, events);
                fetched_any = true;
            }
            Err(e) => {
                errors.insert(key, e.to_string());
            }
        }
    }
    if fetched_any {
        // Only the cache changed here: merge it into the file as it is now (a login may have changed the accounts meanwhile).
        let cache = file.cache.clone();
        update_file(&dir, move |f| f.cache.extend(cache))?;
    }
    let mut out = BTreeMap::new();
    for (project, project_links) in links {
        let mut events = Vec::new();
        let mut needs_login = false;
        let mut failures: Vec<String> = Vec::new();
        for link in &project_links {
            if !file.accounts.contains(&link.account) {
                needs_login = true;
            }
            if let Some(e) = file.get(&link.account, &link.calendar_id) {
                events.extend(e.events.iter().cloned().map(|event| PlacedEvent {
                    event,
                    color: link.color.clone(),
                    calendar: link.name.clone(),
                }));
            }
            if let Some(msg) = errors.get(&(link.account.clone(), link.calendar_id.clone()))
                && !failures.contains(msg)
            {
                failures.push(msg.clone());
            }
        }
        events.sort_by(|a, b| {
            let key = |p: &PlacedEvent| {
                (
                    p.event.date,
                    !p.event.all_day,
                    p.event.start_time.clone(),
                    p.event.title.clone(),
                )
            };
            key(a).cmp(&key(b))
        });
        events.retain(|p| p.event.date >= from && p.event.date <= to);
        out.insert(
            project,
            ProjectEvents {
                events,
                needs_login,
                error: (!failures.is_empty()).then(|| failures.join(" / ")),
            },
        );
    }
    Ok(out)
}
