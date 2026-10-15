//! Natural language → RRULE (仕様 §3.2). Japanese and English. Pure.

use super::recurrence::join;

const JA_DAYS: [(char, &str); 7] = [
    ('月', "MO"),
    ('火', "TU"),
    ('水', "WE"),
    ('木', "TH"),
    ('金', "FR"),
    ('土', "SA"),
    ('日', "SU"),
];
/// (3-letter abbreviation, full name, code). Only these exact spellings are accepted.
const EN_DAYS: [(&str, &str, &str); 7] = [
    ("mon", "monday", "MO"),
    ("tue", "tuesday", "TU"),
    ("wed", "wednesday", "WE"),
    ("thu", "thursday", "TH"),
    ("fri", "friday", "FR"),
    ("sat", "saturday", "SA"),
    ("sun", "sunday", "SU"),
];
/// (3-letter abbreviation, full name).
const EN_MONTHS: [(&str, &str); 12] = [
    ("jan", "january"),
    ("feb", "february"),
    ("mar", "march"),
    ("apr", "april"),
    ("may", "may"),
    ("jun", "june"),
    ("jul", "july"),
    ("aug", "august"),
    ("sep", "september"),
    ("oct", "october"),
    ("nov", "november"),
    ("dec", "december"),
];
/// Longest day count per month (February allows the 29th).
const MONTH_MAX_DAY: [u32; 12] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/// Full-width digits → ASCII; everything else unchanged.
fn ascii_digits(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '０'..='９' => char::from_u32(c as u32 - '０' as u32 + '0' as u32).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// Strips a trailing `!` / `！` (completion-based marker). Returns (word, from_completed).
fn bang(word: &str) -> (&str, bool) {
    if let Some(w) = word.strip_suffix('!').or_else(|| word.strip_suffix('！')) {
        (w, true)
    } else {
        (word, false)
    }
}

/// `月水金` → `MO,WE,FR`; `月曜` / `月曜日` / `土日` also accepted (a 日 inside the list is Sunday).
/// None when any char is not a weekday.
fn ja_weekdays(s: &str) -> Option<String> {
    let s = s
        .strip_suffix("曜日")
        .or_else(|| s.strip_suffix('曜'))
        .unwrap_or(s);
    if s.is_empty() {
        return None;
    }
    let codes: Option<Vec<&str>> = s
        .chars()
        .map(|c| {
            JA_DAYS
                .iter()
                .find(|(ja, _)| *ja == c)
                .map(|(_, code)| *code)
        })
        .collect();
    codes.map(|c| c.join(","))
}

/// `mon,wed,fri` / `monday` → `MO,WE,FR`.
fn en_weekdays(s: &str) -> Option<String> {
    let codes: Option<Vec<&str>> = s
        .split(',')
        .map(|d| {
            let d = d.trim().to_ascii_lowercase();
            EN_DAYS
                .iter()
                .find(|(abbr, full, _)| d == *abbr || d == *full)
                .map(|(_, _, code)| *code)
        })
        .collect();
    codes.filter(|c| !c.is_empty()).map(|c| c.join(","))
}

fn day_of_month(s: &str) -> Option<u32> {
    number(s).filter(|d| (1..=31).contains(d))
}

fn month_number(s: &str) -> Option<u32> {
    number(s).filter(|m| (1..=12).contains(m))
}

/// `month` / `day` as a real calendar date (any year: Feb 29 is allowed).
fn month_day(month: u32, day: u32) -> Option<(u32, u32)> {
    let max = *MONTH_MAX_DAY.get(month.checked_sub(1)? as usize)?;
    (1..=max).contains(&day).then_some((month, day))
}

fn interval(s: &str) -> Option<u32> {
    number(s).filter(|n| (1..=999).contains(n))
}

fn number(s: &str) -> Option<u32> {
    let s = s
        .trim_end_matches("st")
        .trim_end_matches("nd")
        .trim_end_matches("rd")
        .trim_end_matches("th");
    s.parse().ok().filter(|n| *n > 0)
}

/// One Japanese word (no spaces inside). Returns the RRULE body (without the completion marker).
fn ja_single(word: &str) -> Option<String> {
    let w = ascii_digits(word);
    let w = w.as_str();
    match w {
        "毎日" => return Some("FREQ=DAILY".into()),
        "平日" => return Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR".into()),
        "毎週" => return Some("FREQ=WEEKLY".into()),
        "隔週" => return Some("FREQ=WEEKLY;INTERVAL=2".into()),
        "毎月" => return Some("FREQ=MONTHLY".into()),
        "毎月末" | "月末" => return Some("FREQ=MONTHLY;BYMONTHDAY=-1".into()),
        "毎年" => return Some("FREQ=YEARLY".into()),
        _ => {}
    }
    if let Some(days) = w.strip_prefix("毎週") {
        return ja_weekdays(days).map(|d| format!("FREQ=WEEKLY;BYDAY={d}"));
    }
    if let Some(rest) = w.strip_prefix("毎年") {
        // 10月18日
        let (m, d) = rest.split_once('月')?;
        let d = d.strip_suffix('日')?;
        let (m, d) = month_day(month_number(m)?, day_of_month(d)?)?;
        return Some(format!("FREQ=YEARLY;BYMONTH={m};BYMONTHDAY={d}"));
    }
    if let Some(rest) = w.strip_prefix("毎月") {
        let d = rest.strip_suffix('日')?;
        return Some(format!("FREQ=MONTHLY;BYMONTHDAY={}", day_of_month(d)?));
    }
    if let Some(n) = w.strip_suffix("日ごと").or_else(|| w.strip_suffix("日毎")) {
        return Some(format!("FREQ=DAILY;INTERVAL={}", interval(n)?));
    }
    if let Some(rest) = w.strip_prefix('毎') {
        // 毎3日 (Todoist style)
        let n = rest.strip_suffix('日')?;
        return Some(format!("FREQ=DAILY;INTERVAL={}", interval(n)?));
    }
    None
}

/// Tries to read a recurrence starting at `words[0]`. Returns the RRULE and the number of words used.
pub fn parse_recurrence(words: &[&str]) -> Option<(String, usize)> {
    let first = *words.first()?;
    let lower = first.to_ascii_lowercase();

    // ---- Japanese: 毎週 / 毎月 + a second word first, then a single word ----
    {
        let (w, from_completed) = bang(first);
        if w == "毎週"
            && let Some(next) = words.get(1)
            && let Some(days) = ja_weekdays(next)
        {
            return Some((
                join(&format!("FREQ=WEEKLY;BYDAY={days}"), from_completed),
                2,
            ));
        }
        if w == "毎月"
            && let Some(next) = words.get(1)
        {
            // 毎月 15日  /  毎月 15 日
            let n = ascii_digits(next);
            if let Some(d) = n.strip_suffix('日').and_then(day_of_month) {
                return Some((
                    join(&format!("FREQ=MONTHLY;BYMONTHDAY={d}"), from_completed),
                    2,
                ));
            }
            if let Some(d) = day_of_month(&n)
                && words.get(2).is_some_and(|w| *w == "日")
            {
                return Some((
                    join(&format!("FREQ=MONTHLY;BYMONTHDAY={d}"), from_completed),
                    3,
                ));
            }
        }
        if let Some(core) = ja_single(w) {
            return Some((join(&core, from_completed), 1));
        }
    }

    // ---- English single words ----
    let (lw, from_completed) = bang(lower.as_str());
    match lw {
        "daily" => return Some((join("FREQ=DAILY", from_completed), 1)),
        "weekdays" => {
            return Some((join("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", from_completed), 1));
        }
        "weekly" => return Some((join("FREQ=WEEKLY", from_completed), 1)),
        "monthly" => {
            // monthly on 15
            if words.get(1).is_some_and(|w| w.eq_ignore_ascii_case("on"))
                && let Some(d) = words
                    .get(2)
                    .and_then(|w| day_of_month(&w.to_ascii_lowercase()))
            {
                return Some((format!("FREQ=MONTHLY;BYMONTHDAY={d}"), 3));
            }
            return Some((join("FREQ=MONTHLY", from_completed), 1));
        }
        "yearly" => return Some((join("FREQ=YEARLY", from_completed), 1)),
        _ => {}
    }
    if lw == "last"
        && words.len() >= 4
        && words[1].eq_ignore_ascii_case("day")
        && words[2].eq_ignore_ascii_case("of")
        && words[3].eq_ignore_ascii_case("month")
    {
        return Some(("FREQ=MONTHLY;BYMONTHDAY=-1".into(), 4));
    }
    if lw != "every" {
        return None;
    }
    let second_lower = words.get(1)?.to_ascii_lowercase();
    let (s, from_completed) = bang(&second_lower);
    match s {
        "day" => return Some((join("FREQ=DAILY", from_completed), 2)),
        "weekday" => {
            return Some((join("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", from_completed), 2));
        }
        "week" => return Some((join("FREQ=WEEKLY", from_completed), 2)),
        "other" => {
            if words.get(2).is_some_and(|w| w.eq_ignore_ascii_case("week")) {
                return Some(("FREQ=WEEKLY;INTERVAL=2".into(), 3));
            }
            return None;
        }
        "month" => {
            if words.get(2).is_some_and(|w| w.eq_ignore_ascii_case("end")) {
                return Some(("FREQ=MONTHLY;BYMONTHDAY=-1".into(), 3));
            }
            // every month on the 1st
            if words.get(2).is_some_and(|w| w.eq_ignore_ascii_case("on")) {
                let mut i = 3;
                if words.get(i).is_some_and(|w| w.eq_ignore_ascii_case("the")) {
                    i += 1;
                }
                if let Some(d) = words
                    .get(i)
                    .and_then(|w| day_of_month(&w.to_ascii_lowercase()))
                {
                    return Some((format!("FREQ=MONTHLY;BYMONTHDAY={d}"), i + 1));
                }
            }
            return Some((join("FREQ=MONTHLY", from_completed), 2));
        }
        "year" => return Some((join("FREQ=YEARLY", from_completed), 2)),
        _ => {}
    }
    if let Some(days) = en_weekdays(s) {
        return Some((
            join(&format!("FREQ=WEEKLY;BYDAY={days}"), from_completed),
            2,
        ));
    }
    if let Some(month) = EN_MONTHS
        .iter()
        .position(|(abbr, full)| s == *abbr || s == *full)
        && let Some(d) = words
            .get(2)
            .and_then(|w| day_of_month(&w.to_ascii_lowercase()))
        && let Some((m, d)) = month_day(month as u32 + 1, d)
    {
        return Some((format!("FREQ=YEARLY;BYMONTH={m};BYMONTHDAY={d}"), 3));
    }
    // every 3 days / every 2 weeks (optionally with a trailing !)
    if let Some(n) = interval(s)
        && let Some(unit) = words.get(2)
    {
        let unit_lower = unit.to_ascii_lowercase();
        let (unit, from_completed) = bang(&unit_lower);
        return match unit {
            "day" | "days" => Some((join(&format!("FREQ=DAILY;INTERVAL={n}"), from_completed), 3)),
            "week" | "weeks" => Some((
                join(&format!("FREQ=WEEKLY;INTERVAL={n}"), from_completed),
                3,
            )),
            "month" | "months" => Some((
                join(&format!("FREQ=MONTHLY;INTERVAL={n}"), from_completed),
                3,
            )),
            _ => None,
        };
    }
    None
}

/// Whole text (the picker's input). Some only when every word belongs to the recurrence.
pub fn parse_recurrence_text(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let (rrule, used) = parse_recurrence(&words)?;
    (used == words.len()).then_some(rrule)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(s: &str) -> Option<String> {
        parse_recurrence_text(s)
    }

    #[test]
    fn japanese_forms() {
        assert_eq!(one("毎日").as_deref(), Some("FREQ=DAILY"));
        assert_eq!(
            one("平日").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
        );
        assert_eq!(one("毎週").as_deref(), Some("FREQ=WEEKLY"));
        assert_eq!(one("毎週月曜").as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(one("毎週月曜日").as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(one("毎週月").as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(one("毎週 月曜").as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(
            one("毎週月水金").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO,WE,FR")
        );
        assert_eq!(one("毎週土日").as_deref(), Some("FREQ=WEEKLY;BYDAY=SA,SU"));
        assert_eq!(one("隔週").as_deref(), Some("FREQ=WEEKLY;INTERVAL=2"));
        assert_eq!(one("毎月").as_deref(), Some("FREQ=MONTHLY"));
        assert_eq!(one("毎月1日").as_deref(), Some("FREQ=MONTHLY;BYMONTHDAY=1"));
        assert_eq!(
            one("毎月 15 日").as_deref(),
            Some("FREQ=MONTHLY;BYMONTHDAY=15")
        );
        assert_eq!(
            one("毎月１５日").as_deref(),
            Some("FREQ=MONTHLY;BYMONTHDAY=15")
        );
        assert_eq!(one("毎月末").as_deref(), Some("FREQ=MONTHLY;BYMONTHDAY=-1"));
        assert_eq!(one("月末").as_deref(), Some("FREQ=MONTHLY;BYMONTHDAY=-1"));
        assert_eq!(one("毎年").as_deref(), Some("FREQ=YEARLY"));
        assert_eq!(
            one("毎年10月18日").as_deref(),
            Some("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=18")
        );
        assert_eq!(one("3日ごと").as_deref(), Some("FREQ=DAILY;INTERVAL=3"));
        assert_eq!(one("３日ごと").as_deref(), Some("FREQ=DAILY;INTERVAL=3"));
        assert_eq!(
            one("毎3日!").as_deref(),
            Some("FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("3日ごと!").as_deref(),
            Some("FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("毎3日！").as_deref(),
            Some("FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED")
        );
    }

    #[test]
    fn english_forms() {
        assert_eq!(one("every day").as_deref(), Some("FREQ=DAILY"));
        assert_eq!(one("Daily").as_deref(), Some("FREQ=DAILY"));
        assert_eq!(
            one("every weekday").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
        );
        assert_eq!(
            one("weekdays").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
        );
        assert_eq!(one("every week").as_deref(), Some("FREQ=WEEKLY"));
        assert_eq!(one("weekly").as_deref(), Some("FREQ=WEEKLY"));
        assert_eq!(one("every monday").as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(one("every mon").as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(
            one("every mon,wed,fri").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO,WE,FR")
        );
        assert_eq!(
            one("every 2 weeks").as_deref(),
            Some("FREQ=WEEKLY;INTERVAL=2")
        );
        assert_eq!(
            one("every other week").as_deref(),
            Some("FREQ=WEEKLY;INTERVAL=2")
        );
        assert_eq!(one("every month").as_deref(), Some("FREQ=MONTHLY"));
        assert_eq!(one("monthly").as_deref(), Some("FREQ=MONTHLY"));
        assert_eq!(
            one("every month on the 1st").as_deref(),
            Some("FREQ=MONTHLY;BYMONTHDAY=1")
        );
        assert_eq!(
            one("monthly on 15").as_deref(),
            Some("FREQ=MONTHLY;BYMONTHDAY=15")
        );
        assert_eq!(
            one("every month end").as_deref(),
            Some("FREQ=MONTHLY;BYMONTHDAY=-1")
        );
        assert_eq!(
            one("last day of month").as_deref(),
            Some("FREQ=MONTHLY;BYMONTHDAY=-1")
        );
        assert_eq!(one("every year").as_deref(), Some("FREQ=YEARLY"));
        assert_eq!(one("yearly").as_deref(), Some("FREQ=YEARLY"));
        assert_eq!(
            one("every oct 18").as_deref(),
            Some("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=18")
        );
        assert_eq!(
            one("every 3 days").as_deref(),
            Some("FREQ=DAILY;INTERVAL=3")
        );
        assert_eq!(
            one("every 3 days!").as_deref(),
            Some("FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED")
        );
    }

    #[test]
    fn impossible_values_are_not_recurrences() {
        assert_eq!(one("毎月32日"), None);
        assert_eq!(one("毎月0日"), None);
        assert_eq!(one("毎年13月1日"), None);
        assert_eq!(one("毎年2月30日"), None);
        assert_eq!(one("毎年4月31日"), None);
        assert_eq!(one("0日ごと"), None);
        assert_eq!(one("毎1000日"), None);
        assert_eq!(one("every month on the 32nd"), None);
        assert_eq!(one("every 0 days"), None);
        assert_eq!(one("every 70000 days"), None);
        assert_eq!(one("every feb 30"), None);
        assert_eq!(
            one("毎年2月29日").as_deref(),
            Some("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29")
        );
        assert_eq!(
            one("every 999 days").as_deref(),
            Some("FREQ=DAILY;INTERVAL=999")
        );
    }

    #[test]
    fn english_names_are_exact() {
        assert_eq!(one("every satisfaction"), None);
        assert_eq!(one("every monster"), None);
        assert_eq!(one("every octopus 18"), None);
        assert_eq!(
            one("every saturday").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=SA")
        );
        assert_eq!(
            one("every october 18").as_deref(),
            Some("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=18")
        );
    }

    #[test]
    fn trailing_bang_means_from_completed() {
        assert_eq!(
            one("weekly!").as_deref(),
            Some("FREQ=WEEKLY;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("monthly!").as_deref(),
            Some("FREQ=MONTHLY;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("weekdays!").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("every week!").as_deref(),
            Some("FREQ=WEEKLY;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("every month!").as_deref(),
            Some("FREQ=MONTHLY;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("every monday!").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO;X-FROM=COMPLETED")
        );
        assert_eq!(
            one("every weekday!").as_deref(),
            Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;X-FROM=COMPLETED")
        );
    }

    #[test]
    fn consumes_only_the_recurrence_words() {
        let words = ["ゴミ出し", "毎週火曜", "8:00"];
        assert_eq!(
            parse_recurrence(&words[1..]),
            Some(("FREQ=WEEKLY;BYDAY=TU".to_string(), 1))
        );
        let words = ["every", "2", "weeks", "p1"];
        assert_eq!(
            parse_recurrence(&words),
            Some(("FREQ=WEEKLY;INTERVAL=2".to_string(), 3))
        );
        assert_eq!(parse_recurrence(&["every"]), None);
        assert_eq!(parse_recurrence(&["明日"]), None);
        assert_eq!(one("毎週 月曜 買い物"), None);
        assert_eq!(one(""), None);
    }
}
