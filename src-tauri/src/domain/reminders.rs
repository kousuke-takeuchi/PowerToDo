//! Reminder codes (リマインダー列) and when they fire (仕様 §4.1). Pure.

use chrono::{Days, Duration, NaiveDate, NaiveDateTime, NaiveTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reminder {
    /// `-0m`, `-10m`, `-30m`, `-60m`: minutes before the due time.
    Before(Duration),
    /// `-1d`: the day before, at the configured notify time.
    DayBefore,
    /// `-1w`: a week before, at the configured notify time.
    WeekBefore,
    /// `YYYY-MM-DDTHH:MM`: a fixed local time.
    At(NaiveDateTime),
}

const BEFORE_MINUTES: [i64; 4] = [0, 10, 30, 60];

pub fn parse_code(code: &str) -> Option<Reminder> {
    match code.trim() {
        "-1d" => Some(Reminder::DayBefore),
        "-1w" => Some(Reminder::WeekBefore),
        c if c.starts_with('-') && c.ends_with('m') => {
            let n: i64 = c[1..c.len() - 1].parse().ok()?;
            BEFORE_MINUTES
                .contains(&n)
                .then(|| Reminder::Before(Duration::minutes(n)))
        }
        c => NaiveDateTime::parse_from_str(c, "%Y-%m-%dT%H:%M")
            .ok()
            .map(Reminder::At),
    }
}

pub fn code_of(r: &Reminder) -> String {
    match r {
        Reminder::Before(d) => format!("-{}m", d.num_minutes()),
        Reminder::DayBefore => "-1d".into(),
        Reminder::WeekBefore => "-1w".into(),
        Reminder::At(t) => t.format("%Y-%m-%dT%H:%M").to_string(),
    }
}

pub fn is_absolute(code: &str) -> bool {
    matches!(parse_code(code), Some(Reminder::At(_)))
}

pub fn fire_time(
    code: &str,
    due: Option<NaiveDate>,
    due_time: Option<NaiveTime>,
    notify_time: NaiveTime,
) -> Option<NaiveDateTime> {
    match parse_code(code)? {
        Reminder::At(t) => Some(t),
        Reminder::Before(d) => due?.and_time(due_time?).checked_sub_signed(d),
        Reminder::DayBefore => Some(due?.checked_sub_days(Days::new(1))?.and_time(notify_time)),
        Reminder::WeekBefore => Some(due?.checked_sub_days(Days::new(7))?.and_time(notify_time)),
    }
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
    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").unwrap()
    }

    #[test]
    fn codes_round_trip() {
        for c in [
            "-0m",
            "-10m",
            "-30m",
            "-60m",
            "-1d",
            "-1w",
            "2026-10-20T09:00",
        ] {
            assert_eq!(code_of(&parse_code(c).unwrap()), c, "{c}");
        }
        assert!(parse_code("-5m").is_none());
        assert!(parse_code("tomorrow").is_none());
        assert!(is_absolute("2026-10-20T09:00"));
        assert!(!is_absolute("-1d"));
    }

    #[test]
    fn relative_with_due_time() {
        let due = Some(d("2026-10-20"));
        let time = Some(t(15, 0));
        assert_eq!(
            fire_time("-0m", due, time, t(9, 0)),
            Some(dt("2026-10-20T15:00"))
        );
        assert_eq!(
            fire_time("-30m", due, time, t(9, 0)),
            Some(dt("2026-10-20T14:30"))
        );
        assert_eq!(
            fire_time("-60m", due, time, t(9, 0)),
            Some(dt("2026-10-20T14:00"))
        );
        assert_eq!(
            fire_time("-1d", due, time, t(9, 0)),
            Some(dt("2026-10-19T09:00"))
        );
        assert_eq!(
            fire_time("-1w", due, time, t(9, 0)),
            Some(dt("2026-10-13T09:00"))
        );
    }

    #[test]
    fn relative_without_due_time() {
        let due = Some(d("2026-10-20"));
        assert_eq!(fire_time("-0m", due, None, t(9, 0)), None);
        assert_eq!(fire_time("-10m", due, None, t(9, 0)), None);
        assert_eq!(
            fire_time("-1d", due, None, t(8, 30)),
            Some(dt("2026-10-19T08:30"))
        );
        assert_eq!(
            fire_time("-1w", due, None, t(9, 0)),
            Some(dt("2026-10-13T09:00"))
        );
    }

    #[test]
    fn absolute_and_missing_due() {
        assert_eq!(
            fire_time("2026-10-20T09:00", None, None, t(9, 0)),
            Some(dt("2026-10-20T09:00"))
        );
        assert_eq!(fire_time("-1d", None, None, t(9, 0)), None);
        assert_eq!(
            fire_time("garbage", Some(d("2026-10-20")), Some(t(15, 0)), t(9, 0)),
            None
        );
    }
}
