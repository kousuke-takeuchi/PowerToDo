//! Recurrence (繰り返し) rules. The workbook stores the RRULE body only (`FREQ=WEEKLY;BYDAY=MO`);
//! `DTSTART` is built from the current due date at computation time (仕様 §3.1). A trailing
//! `;X-FROM=COMPLETED` marks completion-based repetition and is stripped before the `rrule` crate
//! sees the rule. Pure: no I/O, no clock.

use std::str::FromStr;

use chrono::{NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use rrule::{RRule, RRuleSet, Tz};

pub const FROM_COMPLETED: &str = "X-FROM=COMPLETED";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub core: String,
    pub from_completed: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum RecurrenceError {
    #[error("繰り返しの指定が読めません: {0}")]
    Invalid(String),
}

pub fn split(rrule: &str) -> Rule {
    let mut from_completed = false;
    let parts: Vec<&str> = rrule
        .trim()
        .split(';')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .filter(|p| {
            if p.eq_ignore_ascii_case(FROM_COMPLETED) {
                from_completed = true;
                false
            } else {
                true
            }
        })
        .collect();
    Rule {
        core: parts.join(";"),
        from_completed,
    }
}

pub fn join(core: &str, from_completed: bool) -> String {
    if from_completed {
        format!("{core};{FROM_COMPLETED}")
    } else {
        core.to_string()
    }
}

fn dt_start(base: NaiveDate, due_time: Option<NaiveTime>) -> NaiveDateTime {
    base.and_time(due_time.unwrap_or(NaiveTime::MIN))
}

/// The first occurrence strictly after `DTSTART` (= `base` at `due_time`). `Ok(None)` when the
/// rule has no further occurrence (COUNT / UNTIL reached).
pub fn next_due(
    rrule: &str,
    due: Option<NaiveDate>,
    due_time: Option<NaiveTime>,
    base: NaiveDate,
) -> Result<Option<NaiveDate>, RecurrenceError> {
    let rule = split(rrule);
    if rule.core.is_empty() {
        return Err(RecurrenceError::Invalid(rrule.to_string()));
    }
    let start_day = if rule.from_completed {
        base
    } else {
        due.unwrap_or(base)
    };
    let start = Tz::LOCAL
        .from_local_datetime(&dt_start(start_day, due_time))
        .single()
        .ok_or_else(|| RecurrenceError::Invalid(rrule.to_string()))?;
    let parsed = RRule::from_str(&rule.core)
        .map_err(|e| RecurrenceError::Invalid(format!("{rrule}: {e}")))?;
    let validated = parsed
        .validate(start)
        .map_err(|e| RecurrenceError::Invalid(format!("{rrule}: {e}")))?;
    // `limit` bounds the iteration (rules that never match must not loop forever).
    let set = RRuleSet::new(start).rrule(validated).limit();
    // The next occurrence is on a later *day* than DTSTART (仕様 §3.1: 当日は含まない), so rules
    // with several occurrences a day (BYHOUR=9,18) still advance the due date.
    let start_day = start.date_naive();
    let next = (&set)
        .into_iter()
        .find(|d| d.date_naive() > start_day)
        .map(|d| d.date_naive());
    match next {
        Some(day) => Ok(Some(day)),
        // COUNT / UNTIL used up: the recurrence is finished.
        None if has_end(&rule.core) => Ok(None),
        // No end condition yet no occurrence: the rule can never match (e.g. Feb 30).
        None => Err(RecurrenceError::Invalid(rrule.to_string())),
    }
}

fn has_end(core: &str) -> bool {
    params(core)
        .iter()
        .any(|(k, _)| k == "COUNT" || k == "UNTIL")
}

const WEEKDAYS: [(&str, &str); 7] = [
    ("MO", "月"),
    ("TU", "火"),
    ("WE", "水"),
    ("TH", "木"),
    ("FR", "金"),
    ("SA", "土"),
    ("SU", "日"),
];

fn params(core: &str) -> Vec<(String, String)> {
    core.split(';')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v.to_ascii_uppercase()))
        .collect()
}

/// 表示用の短い要約 (仕様 §3.2 の表の逆方向)。表に無い形は `None`。
pub fn summarize(rrule: &str) -> Option<String> {
    let rule = split(rrule);
    let ps = params(&rule.core);
    let get = |k: &str| ps.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str());
    let known = ["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH"];
    if ps.iter().any(|(k, _)| !known.contains(&k.as_str())) {
        return None;
    }
    let freq = get("FREQ")?;
    let interval: u32 = get("INTERVAL").map(|v| v.parse().ok()).unwrap_or(Some(1))?;
    let suffix = if rule.from_completed {
        " (完了日から)"
    } else {
        ""
    };
    let body = match (
        freq,
        interval,
        get("BYDAY"),
        get("BYMONTHDAY"),
        get("BYMONTH"),
    ) {
        ("DAILY", 1, None, None, None) => "毎日".to_string(),
        ("DAILY", n, None, None, None) => format!("{n}日ごと"),
        ("WEEKLY", 1, Some("MO,TU,WE,TH,FR"), None, None) => "平日".to_string(),
        ("WEEKLY", 1, None, None, None) => "毎週".to_string(),
        ("WEEKLY", 2, None, None, None) => "隔週".to_string(),
        ("WEEKLY", 1, Some(days), None, None) => {
            let names: Option<Vec<&str>> = days
                .split(',')
                .map(|d| {
                    WEEKDAYS
                        .iter()
                        .find(|(code, _)| *code == d)
                        .map(|(_, ja)| *ja)
                })
                .collect();
            format!("毎週{}曜", names?.join("・"))
        }
        ("MONTHLY", 1, None, None, None) => "毎月".to_string(),
        ("MONTHLY", 1, None, Some("-1"), None) => "毎月末".to_string(),
        ("MONTHLY", 1, None, Some(day), None) => format!("毎月{}日", day.parse::<u32>().ok()?),
        ("YEARLY", 1, None, None, None) => "毎年".to_string(),
        ("YEARLY", 1, None, Some(day), Some(month)) => {
            format!(
                "毎年{}月{}日",
                month.parse::<u32>().ok()?,
                day.parse::<u32>().ok()?
            )
        }
        _ => return None,
    };
    Some(format!("{body}{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, NaiveTime};

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn split_and_join_from_completed() {
        let r = split("FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED");
        assert_eq!(r.core, "FREQ=DAILY;INTERVAL=3");
        assert!(r.from_completed);
        let r = split(" FREQ=WEEKLY;BYDAY=MO ");
        assert_eq!(r.core, "FREQ=WEEKLY;BYDAY=MO");
        assert!(!r.from_completed);
        assert_eq!(join("FREQ=DAILY", true), "FREQ=DAILY;X-FROM=COMPLETED");
        assert_eq!(join("FREQ=DAILY", false), "FREQ=DAILY");
    }

    #[test]
    fn weekly_moves_to_next_monday_after_due() {
        // 2026-10-19 is a Monday.
        let next = next_due(
            "FREQ=WEEKLY;BYDAY=MO",
            Some(d("2026-10-19")),
            None,
            d("2026-10-19"),
        )
        .unwrap();
        assert_eq!(next, Some(d("2026-10-26")));
        // Due on a Wednesday with a Monday rule: next Monday, not the same week's.
        let next = next_due(
            "FREQ=WEEKLY;BYDAY=MO",
            Some(d("2026-10-21")),
            None,
            d("2026-10-21"),
        )
        .unwrap();
        assert_eq!(next, Some(d("2026-10-26")));
    }

    #[test]
    fn completion_based_uses_completion_day() {
        // Due 10/01, completed late on 10/13: next is 10/16, not 10/04.
        let next = next_due(
            "FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED",
            Some(d("2026-10-01")),
            Some(t(9, 0)),
            d("2026-10-13"),
        )
        .unwrap();
        assert_eq!(next, Some(d("2026-10-16")));
    }

    #[test]
    fn monthly_on_31st_skips_short_months() {
        let next = next_due(
            "FREQ=MONTHLY;BYMONTHDAY=31",
            Some(d("2026-01-31")),
            None,
            d("2026-01-31"),
        )
        .unwrap();
        assert_eq!(next, Some(d("2026-03-31")));
        let next = next_due(
            "FREQ=MONTHLY;BYMONTHDAY=-1",
            Some(d("2026-01-31")),
            None,
            d("2026-01-31"),
        )
        .unwrap();
        assert_eq!(next, Some(d("2026-02-28")));
    }

    #[test]
    fn count_exhausted_ends_recurrence() {
        // COUNT counts from DTSTART, so COUNT=1 means the current occurrence was the last.
        let next = next_due(
            "FREQ=DAILY;COUNT=1",
            Some(d("2026-10-13")),
            None,
            d("2026-10-13"),
        )
        .unwrap();
        assert_eq!(next, None);
    }

    #[test]
    fn several_occurrences_a_day_still_advance_a_day() {
        let mut dt_due = d("2026-10-19");
        for rule in ["FREQ=DAILY;BYHOUR=9,18", "FREQ=HOURLY;BYMINUTE=0"] {
            let next = next_due(rule, Some(dt_due), Some(t(9, 0)), dt_due).unwrap();
            assert_eq!(next, Some(d("2026-10-20")), "{rule}");
            dt_due = d("2026-10-19");
        }
    }

    #[test]
    fn rule_that_never_matches_is_an_error_not_the_end() {
        assert!(matches!(
            next_due(
                "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
                Some(d("2026-10-13")),
                None,
                d("2026-10-13")
            ),
            Err(RecurrenceError::Invalid(_))
        ));
        // COUNT / UNTIL used up is a normal end.
        assert_eq!(
            next_due(
                "FREQ=DAILY;COUNT=1",
                Some(d("2026-10-13")),
                None,
                d("2026-10-13")
            )
            .unwrap(),
            None
        );
        assert_eq!(
            next_due(
                "FREQ=DAILY;UNTIL=20261013T000000Z",
                Some(d("2026-10-13")),
                None,
                d("2026-10-13")
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn invalid_rrule_is_an_error() {
        assert!(matches!(
            next_due(
                "FREQ=SOMETIMES",
                Some(d("2026-10-13")),
                None,
                d("2026-10-13")
            ),
            Err(RecurrenceError::Invalid(_))
        ));
        assert!(matches!(
            next_due("", Some(d("2026-10-13")), None, d("2026-10-13")),
            Err(RecurrenceError::Invalid(_))
        ));
    }

    #[test]
    fn summaries() {
        assert_eq!(summarize("FREQ=DAILY").as_deref(), Some("毎日"));
        assert_eq!(
            summarize("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR").as_deref(),
            Some("平日")
        );
        assert_eq!(
            summarize("FREQ=WEEKLY;BYDAY=MO").as_deref(),
            Some("毎週月曜")
        );
        assert_eq!(
            summarize("FREQ=WEEKLY;BYDAY=MO,WE,FR").as_deref(),
            Some("毎週月・水・金曜")
        );
        assert_eq!(summarize("FREQ=WEEKLY;INTERVAL=2").as_deref(), Some("隔週"));
        assert_eq!(
            summarize("FREQ=MONTHLY;BYMONTHDAY=18").as_deref(),
            Some("毎月18日")
        );
        assert_eq!(
            summarize("FREQ=MONTHLY;BYMONTHDAY=-1").as_deref(),
            Some("毎月末")
        );
        assert_eq!(
            summarize("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=18").as_deref(),
            Some("毎年10月18日")
        );
        assert_eq!(
            summarize("FREQ=DAILY;INTERVAL=3").as_deref(),
            Some("3日ごと")
        );
        assert_eq!(
            summarize("FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED").as_deref(),
            Some("3日ごと (完了日から)")
        );
        assert_eq!(summarize("FREQ=WEEKLY").as_deref(), Some("毎週"));
        assert_eq!(summarize("FREQ=MONTHLY").as_deref(), Some("毎月"));
        assert_eq!(summarize("FREQ=YEARLY").as_deref(), Some("毎年"));
        assert_eq!(
            summarize("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T000000Z"),
            None
        );
    }
}
