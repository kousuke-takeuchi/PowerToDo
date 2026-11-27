//! Calls to the Google Calendar API (read-only). The base URL is a parameter so tests can stand in for Google.

use chrono::{DateTime, FixedOffset, NaiveDateTime};
use serde_json::Value;
use url::Url;

use super::model::{CalEvent, CalendarInfo};
use super::parse::{parse_calendar_list, parse_events};
use crate::sync::oauth::{TokenSource, http_client, transport};

pub const BASE: &str = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES: usize = 10;

/// What went wrong, in a text that can be shown as it is (no URL, no token).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CalError {
    /// The login no longer works (revoked, expired, the scope was taken back): log in again.
    #[error("Google のログインが無効になりました。もう一度ログインしてください")]
    Auth,
    #[error("{0}")]
    Offline(String),
    #[error("{0}")]
    Other(String),
}

impl From<crate::sync::oauth::OAuthError> for CalError {
    fn from(e: crate::sync::oauth::OAuthError) -> Self {
        use crate::sync::oauth::OAuthError as E;
        match e {
            E::InvalidGrant => CalError::Auth,
            E::Offline(m) => CalError::Offline(m),
            other => CalError::Other(other.to_string()),
        }
    }
}

pub struct CalendarApi {
    http: reqwest::Client,
    base: String,
}

impl CalendarApi {
    pub fn new(base: &str) -> Result<Self, CalError> {
        Ok(CalendarApi {
            http: http_client()?,
            base: base.trim_end_matches('/').to_string(),
        })
    }

    pub fn production() -> Result<Self, CalError> {
        Self::new(BASE)
    }

    async fn get(&self, ts: &TokenSource, url: Url) -> Result<Value, CalError> {
        let mut token = ts.access_token().await?;
        for attempt in 0..2 {
            let resp = self
                .http
                .get(url.clone())
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|e| CalError::Offline(crate::calendar::http::transport_text(&e)))?;
            let status = resp.status().as_u16();
            match status {
                200 => {
                    return resp
                        .json::<Value>()
                        .await
                        .map_err(|_| CalError::Other("Google の応答を読めませんでした".into()));
                }
                // Once: the token may just have expired. The second time the login is the problem.
                401 if attempt == 0 => token = ts.renew(&token).await?,
                401 | 403 => return Err(CalError::Auth),
                404 => return Err(CalError::Other("カレンダーが見つかりません".into())),
                429 | 500..=599 => {
                    return Err(CalError::Offline(
                        "Google が混み合っています。しばらくしてからやり直してください".into(),
                    ));
                }
                _ => {
                    return Err(CalError::Other(format!(
                        "Google のカレンダーを読めませんでした ({status})"
                    )));
                }
            }
        }
        Err(CalError::Auth)
    }

    fn url(&self, segments: &[&str], query: &[(&str, &str)]) -> Result<Url, CalError> {
        let mut url = Url::parse(&self.base)
            .map_err(|_| CalError::Other("カレンダーのアドレスが正しくありません".into()))?;
        url.path_segments_mut()
            .map_err(|_| CalError::Other("カレンダーのアドレスが正しくありません".into()))?
            .pop_if_empty()
            .extend(segments);
        url.query_pairs_mut().extend_pairs(query);
        Ok(url)
    }

    /// The calendars of the account (the ones it can read).
    pub async fn calendars(&self, ts: &TokenSource) -> Result<Vec<CalendarInfo>, CalError> {
        let url = self.url(
            &["users", "me", "calendarList"],
            &[("minAccessRole", "reader"), ("maxResults", "250")],
        )?;
        Ok(parse_calendar_list(&self.get(ts, url).await?))
    }

    /// The events from `time_min` to `time_max` (RFC 3339), recurring ones expanded.
    pub async fn events(
        &self,
        ts: &TokenSource,
        calendar_id: &str,
        time_min: &str,
        time_max: &str,
        to_local: impl Fn(DateTime<FixedOffset>) -> NaiveDateTime,
    ) -> Result<Vec<CalEvent>, CalError> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut query = vec![
                ("singleEvents", "true"),
                ("orderBy", "startTime"),
                ("timeMin", time_min),
                ("timeMax", time_max),
                ("maxResults", "250"),
            ];
            if let Some(p) = &page {
                query.push(("pageToken", p));
            }
            let url = self.url(&["calendars", calendar_id, "events"], &query)?;
            let json = self.get(ts, url).await?;
            out.extend(parse_events(&json, &to_local));
            match json["nextPageToken"].as_str() {
                Some(next) => page = Some(next.to_string()),
                None => break,
            }
        }
        Ok(out)
    }
}

/// A transport failure in words, without the URL a reqwest error would quote.
pub(crate) fn transport_text(e: &reqwest::Error) -> String {
    transport(e).to_string()
}
