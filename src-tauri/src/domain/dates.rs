use chrono::{Datelike, Duration, NaiveDate, NaiveTime, Weekday};

/// Business days between `start` and `end`, both inclusive, excluding Saturdays,
/// Sundays and `holidays`. `end < start` yields 0.
pub fn business_days(start: NaiveDate, end: NaiveDate, holidays: &[NaiveDate]) -> u32 {
    if end < start {
        return 0;
    }
    let mut count = 0;
    let mut day = start;
    loop {
        let weekend = matches!(day.weekday(), Weekday::Sat | Weekday::Sun);
        if !weekend && !holidays.contains(&day) {
            count += 1;
        }
        if day == end {
            break;
        }
        day += Duration::days(1);
    }
    count
}

/// A date word as typed by the user, before it is anchored to a concrete "today".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelDate {
    Today,
    Tomorrow,
    DayAfterTomorrow,
    ThisWeekend,
    NextWeek,
    NextWeekday(Weekday),
    MonthDay(u32, u32),
    Ymd(NaiveDate),
}

/// Parse a Japanese or English date word. Returns `None` for anything else.
pub fn parse_date_word(word: &str) -> Option<RelDate> {
    let w = word.trim();
    if w.is_empty() {
        return None;
    }
    match w {
        "今日" => return Some(RelDate::Today),
        "明日" => return Some(RelDate::Tomorrow),
        "明後日" => return Some(RelDate::DayAfterTomorrow),
        "今週末" => return Some(RelDate::ThisWeekend),
        "来週" => return Some(RelDate::NextWeek),
        _ => {}
    }
    if let Some(rest) = w.strip_prefix("来週") {
        return parse_ja_weekday(rest).map(RelDate::NextWeekday);
    }

    let lower = w.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();
    match words.as_slice() {
        ["today"] => return Some(RelDate::Today),
        ["tomorrow"] => return Some(RelDate::Tomorrow),
        ["next", "week"] => return Some(RelDate::NextWeek),
        ["next", day] => return parse_en_weekday(day).map(RelDate::NextWeekday),
        _ => {}
    }

    parse_numeric_date(w)
}

fn parse_ja_weekday(s: &str) -> Option<Weekday> {
    let s = s
        .strip_suffix("曜日")
        .or_else(|| s.strip_suffix('曜'))
        .unwrap_or(s);
    match s {
        "月" => Some(Weekday::Mon),
        "火" => Some(Weekday::Tue),
        "水" => Some(Weekday::Wed),
        "木" => Some(Weekday::Thu),
        "金" => Some(Weekday::Fri),
        "土" => Some(Weekday::Sat),
        "日" => Some(Weekday::Sun),
        _ => None,
    }
}

fn parse_en_weekday(s: &str) -> Option<Weekday> {
    match s {
        "mon" | "monday" => Some(Weekday::Mon),
        "tue" | "tuesday" => Some(Weekday::Tue),
        "wed" | "wednesday" => Some(Weekday::Wed),
        "thu" | "thursday" => Some(Weekday::Thu),
        "fri" | "friday" => Some(Weekday::Fri),
        "sat" | "saturday" => Some(Weekday::Sat),
        "sun" | "sunday" => Some(Weekday::Sun),
        _ => None,
    }
}

fn num(s: &str) -> Option<u32> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Valid month/day in some year (2/29 is accepted).
fn valid_month_day(m: u32, d: u32) -> bool {
    NaiveDate::from_ymd_opt(2000, m, d).is_some()
}

fn parse_numeric_date(w: &str) -> Option<RelDate> {
    // M月D日
    if let Some(body) = w.strip_suffix('日')
        && let Some((m, d)) = body.split_once('月')
    {
        let (m, d) = (num(m)?, num(d)?);
        return valid_month_day(m, d).then_some(RelDate::MonthDay(m, d));
    }
    for sep in ['-', '/'] {
        let parts: Vec<&str> = w.split(sep).collect();
        match parts.as_slice() {
            // M/D
            [m, d] if sep == '/' => {
                let (m, d) = (num(m)?, num(d)?);
                return valid_month_day(m, d).then_some(RelDate::MonthDay(m, d));
            }
            // YYYY-MM-DD / YYYY/M/D
            [y, m, d] if y.len() == 4 => {
                let date = NaiveDate::from_ymd_opt(num(y)? as i32, num(m)?, num(d)?)?;
                return Some(RelDate::Ymd(date));
            }
            _ => {}
        }
    }
    None
}

/// Anchor a date word to `today`.
/// `NextWeek` is the coming Monday; `NextWeekday(x)` is the first `x` on or after that Monday;
/// `ThisWeekend` is the next Saturday (today if it is a Saturday);
/// `MonthDay` is that day in `today`'s year even if already past; a day that does not exist
/// in that year (2/29 in a non-leap year) yields `None`. Every other word yields `Some`.
pub fn resolve(rel: RelDate, today: NaiveDate) -> Option<NaiveDate> {
    let next_monday = || {
        let ahead = 7 - i64::from(today.weekday().num_days_from_monday());
        today + Duration::days(ahead)
    };
    let date = match rel {
        RelDate::Today => today,
        RelDate::Tomorrow => today + Duration::days(1),
        RelDate::DayAfterTomorrow => today + Duration::days(2),
        RelDate::ThisWeekend => {
            let sat = i64::from(Weekday::Sat.num_days_from_monday());
            let now = i64::from(today.weekday().num_days_from_monday());
            today + Duration::days((sat - now).rem_euclid(7))
        }
        RelDate::NextWeek => next_monday(),
        RelDate::NextWeekday(w) => {
            next_monday() + Duration::days(i64::from(w.num_days_from_monday()))
        }
        RelDate::MonthDay(m, d) => return NaiveDate::from_ymd_opt(today.year(), m, d),
        RelDate::Ymd(date) => date,
    };
    Some(date)
}

/// Parse a time word: `15:00`, `15時`, `15時30分`, `午後3時`, `午前9時30分`, `3pm`, `3:30am`, `12pm`.
pub fn parse_time_word(word: &str) -> Option<NaiveTime> {
    let w = word.trim().to_lowercase();
    if w.is_empty() {
        return None;
    }
    // 午前 / 午後
    if let Some(rest) = w.strip_prefix("午前") {
        return ja_time(rest, Some(false));
    }
    if let Some(rest) = w.strip_prefix("午後") {
        return ja_time(rest, Some(true));
    }
    // 3pm / 3:30am
    if let Some(body) = w.strip_suffix("pm") {
        return twelve_hour(body, true);
    }
    if let Some(body) = w.strip_suffix("am") {
        return twelve_hour(body, false);
    }
    // 15:00
    if let Some((h, m)) = w.split_once(':') {
        return hm(num(h)?, num(m)?);
    }
    ja_time(&w, None)
}

fn hm(h: u32, m: u32) -> Option<NaiveTime> {
    NaiveTime::from_hms_opt(h, m, 0)
}

/// `H時` / `H時M分`; `pm` shifts a 1..=11 hour into the afternoon (午後12時 stays 12).
fn ja_time(s: &str, pm: Option<bool>) -> Option<NaiveTime> {
    let (h, rest) = s.split_once('時')?;
    let mut h = num(h)?;
    let m = if rest.is_empty() {
        0
    } else {
        num(rest.strip_suffix('分')?)?
    };
    if let Some(pm) = pm {
        if h > 12 {
            return None;
        }
        h = to_24h(h, pm);
    }
    hm(h, m)
}

fn twelve_hour(body: &str, pm: bool) -> Option<NaiveTime> {
    let (h, m) = match body.split_once(':') {
        Some((h, m)) => (num(h)?, num(m)?),
        None => (num(body)?, 0),
    };
    if !(1..=12).contains(&h) {
        return None;
    }
    hm(to_24h(h, pm), m)
}

/// 12-hour clock to 24-hour: 12am -> 0, 12pm -> 12, other pm hours +12.
fn to_24h(h: u32, pm: bool) -> u32 {
    match (h, pm) {
        (12, true) => 12,
        (12, false) => 0,
        (h, true) => h + 12,
        (h, false) => h,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn business_days_skips_weekends_and_holidays() {
        assert_eq!(business_days(d("2026-10-13"), d("2026-10-17"), &[]), 4); // Tue..Sat -> Tue Wed Thu Fri
        assert_eq!(
            business_days(d("2026-10-13"), d("2026-10-17"), &[d("2026-10-15")]),
            3
        );
        assert_eq!(business_days(d("2026-10-17"), d("2026-10-13"), &[]), 0);
    }

    #[test]
    fn business_days_same_day() {
        assert_eq!(business_days(d("2026-10-13"), d("2026-10-13"), &[]), 1);
        assert_eq!(business_days(d("2026-10-17"), d("2026-10-17"), &[]), 0); // Saturday
        assert_eq!(
            business_days(d("2026-10-13"), d("2026-10-13"), &[d("2026-10-13")]),
            0
        );
    }

    #[test]
    fn relative_words_resolve_from_tuesday() {
        let today = d("2026-10-13"); // Tuesday
        assert_eq!(
            resolve(parse_date_word("明日").unwrap(), today),
            Some(d("2026-10-14"))
        );
        assert_eq!(
            resolve(parse_date_word("今週末").unwrap(), today),
            Some(d("2026-10-17"))
        );
        assert_eq!(
            resolve(parse_date_word("来週月曜").unwrap(), today),
            Some(d("2026-10-19"))
        );
        assert_eq!(
            resolve(parse_date_word("next fri").unwrap(), today),
            Some(d("2026-10-23"))
        );
        assert_eq!(
            resolve(parse_date_word("10/20").unwrap(), today),
            Some(d("2026-10-20"))
        );
        assert_eq!(
            resolve(parse_date_word("10月20日").unwrap(), today),
            Some(d("2026-10-20"))
        );
        assert_eq!(parse_date_word("買い物"), None);
    }

    #[test]
    fn simple_words() {
        let today = d("2026-10-13");
        let r = |w: &str| resolve(parse_date_word(w).unwrap(), today).unwrap();
        assert_eq!(r("今日"), d("2026-10-13"));
        assert_eq!(r("today"), d("2026-10-13"));
        assert_eq!(r("明後日"), d("2026-10-15"));
        assert_eq!(r("tomorrow"), d("2026-10-14"));
        assert_eq!(r("来週"), d("2026-10-19"));
        assert_eq!(r("next week"), d("2026-10-19"));
        assert_eq!(r("来週日曜"), d("2026-10-25"));
        assert_eq!(r("来週月"), d("2026-10-19"));
        assert_eq!(r("来週水曜日"), d("2026-10-21"));
        assert_eq!(r("next mon"), d("2026-10-19"));
        assert_eq!(r("Next Sunday"), d("2026-10-25"));
        assert_eq!(r("2026-10-20"), d("2026-10-20"));
        assert_eq!(r("2027/1/5"), d("2027-01-05"));
    }

    #[test]
    fn weekend_resolution_edges() {
        // Saturday -> itself, Sunday -> next Saturday
        assert_eq!(
            resolve(RelDate::ThisWeekend, d("2026-10-17")),
            Some(d("2026-10-17"))
        );
        assert_eq!(
            resolve(RelDate::ThisWeekend, d("2026-10-18")),
            Some(d("2026-10-24"))
        );
        // Monday -> next Monday (a full week later)
        assert_eq!(
            resolve(RelDate::NextWeek, d("2026-10-19")),
            Some(d("2026-10-26"))
        );
    }

    #[test]
    fn month_day_stays_in_current_year_even_if_past() {
        assert_eq!(
            resolve(RelDate::MonthDay(1, 5), d("2026-10-13")),
            Some(d("2026-01-05"))
        );
    }

    #[test]
    fn month_day_feb_29_only_in_leap_years() {
        assert_eq!(
            resolve(RelDate::MonthDay(2, 29), d("2028-02-01")),
            Some(d("2028-02-29"))
        );
        assert_eq!(resolve(RelDate::MonthDay(2, 29), d("2027-02-01")), None);
        assert_eq!(
            resolve(RelDate::Ymd(d("2027-03-01")), d("2027-02-01")),
            Some(d("2027-03-01"))
        );
    }

    #[test]
    fn to_24h_maps_twelve_hour_clock() {
        assert_eq!(to_24h(12, false), 0);
        assert_eq!(to_24h(12, true), 12);
        assert_eq!(to_24h(3, true), 15);
        assert_eq!(to_24h(9, false), 9);
    }

    #[test]
    fn rejects_invalid_dates() {
        assert_eq!(parse_date_word("13/40"), None);
        assert_eq!(parse_date_word("2026-02-30"), None);
        assert_eq!(parse_date_word("0/5"), None);
        assert_eq!(parse_date_word(""), None);
        assert_eq!(parse_date_word("来週あ"), None);
        assert_eq!(parse_date_word("next foo"), None);
    }

    #[test]
    fn time_words() {
        assert_eq!(parse_time_word("15:00"), Some(t(15, 0)));
        assert_eq!(parse_time_word("3pm"), Some(t(15, 0)));
        assert_eq!(parse_time_word("15時30分"), Some(t(15, 30)));
        assert_eq!(parse_time_word("abc"), None);
    }

    #[test]
    fn more_time_words() {
        assert_eq!(parse_time_word("9:05"), Some(t(9, 5)));
        assert_eq!(parse_time_word("15時"), Some(t(15, 0)));
        assert_eq!(parse_time_word("午後3時"), Some(t(15, 0)));
        assert_eq!(parse_time_word("午前9時30分"), Some(t(9, 30)));
        assert_eq!(parse_time_word("3am"), Some(t(3, 0)));
        assert_eq!(parse_time_word("12pm"), Some(t(12, 0)));
        assert_eq!(parse_time_word("12am"), Some(t(0, 0)));
        assert_eq!(parse_time_word("3:30PM"), Some(t(15, 30)));
        assert_eq!(parse_time_word("24:00"), None);
        assert_eq!(parse_time_word("13pm"), None);
        assert_eq!(parse_time_word("10:75"), None);
        assert_eq!(parse_time_word(""), None);
    }
}
