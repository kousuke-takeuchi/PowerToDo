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
/// Google's description holds a little HTML (`<br>`, `<a>`, lists, entities). As plain text: line breaks kept, tags dropped.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let Some(j) = rest[i..].find('>') else {
            rest = "";
            break;
        };
        let raw = rest[i + 1..i + j].to_ascii_lowercase();
        let closing = raw.starts_with('/');
        let name = raw
            .trim_start_matches('/')
            .split(|c: char| !c.is_ascii_alphanumeric())
            .next()
            .unwrap_or("");
        match name {
            // A line break; a list item starts a line when it opens (not again when it closes).
            "br" => out.push('\n'),
            "li" if !closing => out.push('\n'),
            "p" | "div" | "tr" | "h1" | "h2" | "h3" | "ul" | "ol" => out.push('\n'),
            _ => {}
        }
        rest = &rest[i + j + 1..];
    }
    out.push_str(rest);
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    // Collapse the blank lines the block tags left.
    let mut lines: Vec<&str> = decoded.lines().map(str::trim_end).collect();
    while lines.first().is_some_and(|l| l.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    let mut text = String::new();
    let mut blank = 0;
    for l in lines {
        if l.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        text.push_str(l);
        text.push('\n');
    }
    text.trim_end().to_string()
}

fn text_field(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The video meeting of an event: its Meet link, else the first video entry point.
fn meeting_link(e: &Value) -> Option<String> {
    text_field(&e["hangoutLink"]).or_else(|| {
        e["conferenceData"]["entryPoints"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| p["entryPointType"].as_str() == Some("video"))
            .and_then(|p| text_field(&p["uri"]))
    })
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
        let location = text_field(&e["location"]);
        let description = e["description"]
            .as_str()
            .map(html_to_text)
            .filter(|s| !s.is_empty());
        let link = text_field(&e["htmlLink"]);
        let meet = meeting_link(e);
        if let Some(start) = day(&e["start"]["date"]) {
            // All day: one entry per day, the end date is the day after the last.
            let end = day(&e["end"]["date"])
                .filter(|end| *end > start)
                .unwrap_or(start + Duration::days(1));
            let last = end - Duration::days(1);
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
                    end_date: (last > start).then_some(last),
                    description: description.clone(),
                    link: link.clone(),
                    meet: meet.clone(),
                });
                d += Duration::days(1);
            }
        } else if let Some(start) = date_time(&e["start"]["dateTime"], &to_local) {
            let end = date_time(&e["end"]["dateTime"], &to_local);
            // A timed event shows on its start day, with its real end (a later day goes in `end_date`).
            out.push(CalEvent {
                id: id.into(),
                title,
                date: start.date(),
                start_time: Some(hhmm(start)),
                end_time: end.map(hhmm),
                all_day: false,
                location,
                end_date: end.map(|t| t.date()).filter(|d| *d > start.date()),
                description,
                link,
                meet,
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
    fn an_event_over_midnight_shows_on_its_start_day_with_its_real_end() {
        let j = json!({ "items": [{ "id": "1", "summary": "夜行", "start": { "dateTime": "2026-11-30T22:00:00+09:00" }, "end": { "dateTime": "2026-12-01T06:00:00+09:00" } }]});
        let e = parse_events(&j, same);
        assert_eq!(
            (e[0].date, e[0].end_time.as_deref(), e[0].end_date),
            (d("2026-11-30"), Some("06:00"), Some(d("2026-12-01")))
        );
    }

    #[test]
    fn the_detail_fields_are_read_and_the_html_becomes_text() {
        let j = json!({ "items": [{ "id": "1", "summary": "会議", "htmlLink": "https://www.google.com/calendar/event?eid=x",
            "hangoutLink": "https://meet.google.com/abc-defg-hij",
            "description": "<p>議題</p><ul><li>予算 &amp; 計画</li><li>採用</li></ul>次回は<br>来週",
            "start": { "dateTime": "2026-11-30T10:00:00+09:00" }, "end": { "dateTime": "2026-11-30T11:00:00+09:00" } }]});
        let e = &parse_events(&j, same)[0];
        assert_eq!(
            e.link.as_deref(),
            Some("https://www.google.com/calendar/event?eid=x")
        );
        assert_eq!(
            e.meet.as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );
        assert_eq!(
            e.description.as_deref(),
            Some("議題\n\n予算 & 計画\n採用\n次回は\n来週")
        );
    }

    #[test]
    fn a_video_entry_point_stands_in_for_a_missing_meet_link() {
        let j = json!({ "items": [{ "id": "1", "summary": "Zoom", "start": { "date": "2026-11-30" }, "end": { "date": "2026-12-01" },
            "conferenceData": { "entryPoints": [{ "entryPointType": "phone", "uri": "tel:+8100" }, { "entryPointType": "video", "uri": "https://zoom.us/j/1" }] } }]});
        assert_eq!(
            parse_events(&j, same)[0].meet.as_deref(),
            Some("https://zoom.us/j/1")
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
        // The 3-day event says where it ends; the one-day event does not.
        assert_eq!(e[0].end_date, Some(d("2026-12-02")));
        assert_eq!(e[3].end_date, None);
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
