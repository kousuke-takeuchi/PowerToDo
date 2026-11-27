//! Google's JSON to our types. Pure: the time zone is a parameter so tests do not depend on the machine's.

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveDateTime};
use serde_json::Value;

use super::model::{CalEvent, CalendarInfo};

const NO_TITLE: &str = "(タイトルなし)";
/// A day-by-day expansion stops here (a runaway all-day event of years does not flood a list).
const MAX_DAYS: i64 = 400;

pub fn parse_calendar_list(json: &Value) -> Vec<CalendarInfo> {
    let mut out: Vec<CalendarInfo> = json["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let id = c["id"].as_str()?.to_string();
            // The account's own name beats a technical summary; a user's rename (`summaryOverride`) beats both.
            let name = c["summaryOverride"]
                .as_str()
                .or_else(|| c["summary"].as_str())
                .unwrap_or(&id)
                .to_string();
            Some(CalendarInfo {
                id,
                name,
                color: c["backgroundColor"].as_str().map(str::to_string),
                primary: c["primary"].as_bool().unwrap_or(false),
            })
        })
        .collect();
    // The primary calendar first, then by name.
    out.sort_by(|a, b| b.primary.cmp(&a.primary).then_with(|| a.name.cmp(&b.name)));
    out
}

fn day(v: &Value) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(v.as_str()?, "%Y-%m-%d").ok()
}

fn date_time(
    v: &Value,
    to_local: &impl Fn(DateTime<FixedOffset>) -> NaiveDateTime,
) -> Option<NaiveDateTime> {
    DateTime::parse_from_rfc3339(v.as_str()?).ok().map(to_local)
}

fn hhmm(t: NaiveDateTime) -> String {
    t.format("%H:%M").to_string()
}

/// The events of an `events.list` page, one `CalEvent` per day. `to_local` turns Google's time (with its
/// offset) into the device's local time. Cancelled events are left out; an all-day event's end date is exclusive.
pub fn parse_events(
    json: &Value,
    to_local: impl Fn(DateTime<FixedOffset>) -> NaiveDateTime,
) -> Vec<CalEvent> {
    let mut out = Vec::new();
    for e in json["items"].as_array().into_iter().flatten() {
        if e["status"].as_str() == Some("cancelled") {
            continue;
        }
        let Some(id) = e["id"].as_str() else { continue };
        let title = e["summary"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(NO_TITLE)
            .to_string();
        let location = e["location"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if let Some(start) = day(&e["start"]["date"]) {
            // All day: one entry per day, the end date is the day after the last.
            let end = day(&e["end"]["date"])
                .filter(|end| *end > start)
                .unwrap_or(start + Duration::days(1));
            let mut d = start;
            while d < end && (d - start).num_days() < MAX_DAYS {
                out.push(CalEvent {
                    id: id.into(),
                    title: title.clone(),
                    date: d,
                    start_time: None,
                    end_time: None,
                    all_day: true,
                    location: location.clone(),
                });
                d += Duration::days(1);
            }
        } else if let Some(start) = date_time(&e["start"]["dateTime"], &to_local) {
            let end = date_time(&e["end"]["dateTime"], &to_local);
            // A timed event shows on its start day, with its times (one that crosses midnight ends at 24:00 there).
            let end_time = end.map(|t| {
                if t.date() == start.date() {
                    hhmm(t)
                } else {
                    "24:00".to_string()
                }
            });
            out.push(CalEvent {
                id: id.into(),
                title,
                date: start.date(),
                start_time: Some(hhmm(start)),
                end_time,
                all_day: false,
                location,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    /// Keep the wall time Google gave (its own offset): the tests are the same in any zone.
    fn same(t: DateTime<FixedOffset>) -> NaiveDateTime {
        t.naive_local()
    }

    #[test]
    fn calendars_are_named_and_the_primary_comes_first() {
        let j = json!({ "items": [
            { "id": "z@group", "summary": "家族", "backgroundColor": "#16a765" },
            { "id": "me@example.com", "summary": "me@example.com", "primary": true, "summaryOverride": "自分" },
            { "id": "a@group", "summary": "仕事" },
        ]});
        let l = parse_calendar_list(&j);
        assert_eq!(
            l.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["自分", "仕事", "家族"]
        );
        assert!(l[0].primary);
        assert_eq!(l[2].color.as_deref(), Some("#16a765"));
    }

    #[test]
    fn a_timed_event_keeps_its_start_and_end_times() {
        let j = json!({ "items": [{ "id": "1", "summary": "会議", "location": " 会議室 ",
            "start": { "dateTime": "2026-11-30T10:00:00+09:00" }, "end": { "dateTime": "2026-11-30T11:30:00+09:00" } }]});
        let e = parse_events(&j, same);
        assert_eq!(e.len(), 1);
        assert_eq!(
            (
                e[0].date,
                e[0].start_time.as_deref(),
                e[0].end_time.as_deref(),
                e[0].all_day
            ),
            (d("2026-11-30"), Some("10:00"), Some("11:30"), false)
        );
        assert_eq!(e[0].location.as_deref(), Some("会議室"));
    }

    #[test]
    fn an_event_over_midnight_shows_on_its_start_day_until_24() {
        let j = json!({ "items": [{ "id": "1", "summary": "夜行", "start": { "dateTime": "2026-11-30T22:00:00+09:00" }, "end": { "dateTime": "2026-12-01T06:00:00+09:00" } }]});
        let e = parse_events(&j, same);
        assert_eq!(
            (e[0].date, e[0].end_time.as_deref()),
            (d("2026-11-30"), Some("24:00"))
        );
    }

    #[test]
    fn an_all_day_event_covers_each_day_and_its_end_is_exclusive() {
        let j = json!({ "items": [
            { "id": "1", "summary": "出張", "start": { "date": "2026-11-30" }, "end": { "date": "2026-12-03" } },
            { "id": "2", "summary": "誕生日", "start": { "date": "2026-12-05" }, "end": { "date": "2026-12-06" } },
        ]});
        let e = parse_events(&j, same);
        assert_eq!(
            e.iter()
                .map(|x| (x.id.as_str(), x.date.to_string()))
                .collect::<Vec<_>>(),
            [
                ("1", "2026-11-30".into()),
                ("1", "2026-12-01".into()),
                ("1", "2026-12-02".into()),
                ("2", "2026-12-05".into())
            ]
        );
        assert!(e.iter().all(|x| x.all_day && x.start_time.is_none()));
    }

    #[test]
    fn cancelled_and_idless_events_are_skipped_and_a_missing_title_is_named() {
        let j = json!({ "items": [
            { "id": "1", "status": "cancelled", "summary": "消えた", "start": { "date": "2026-11-30" }, "end": { "date": "2026-12-01" } },
            { "summary": "idなし", "start": { "date": "2026-11-30" }, "end": { "date": "2026-12-01" } },
            { "id": "3", "start": { "date": "2026-11-30" }, "end": { "date": "2026-12-01" } },
        ]});
        let e = parse_events(&j, same);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].title, "(タイトルなし)");
    }
}
