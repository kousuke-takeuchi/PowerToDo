use chrono::{NaiveDate, NaiveTime};
use serde::Serialize;

use super::dates::{parse_date_word, parse_time_word, resolve};
use super::model::{Priority, serde_time};
use super::recurrence_words::parse_recurrence;

/// A recognised token. Offsets are `char` indices into the original text (not bytes).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub kind: TokenKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenKind {
    Date,
    Time,
    Recurrence,
    Priority,
    Project,
    Label,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddResult {
    pub title: String,
    pub due: Option<NaiveDate>,
    #[serde(with = "serde_time::option")]
    pub due_time: Option<NaiveTime>,
    /// Recurrence from words like 毎週火曜 / every 2 weeks. Does not set `due`; the caller
    /// decides the first due date.
    pub rrule: Option<String>,
    pub priority: Option<Priority>,
    pub project: Option<String>,
    pub labels: Vec<String>,
    pub spans: Vec<Span>,
}

/// One whitespace-separated word of the input. Offsets are `char` indices.
struct Token {
    start: usize,
    end: usize,
    text: String,
    /// `#"..."` with both quotes present.
    quoted: bool,
}

fn tokenize(text: &str) -> Vec<Token> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < n {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        if chars[i] == '#'
            && i + 1 < n
            && chars[i + 1] == '"'
            && let Some(rel) = chars[i + 2..].iter().position(|&c| c == '"')
        {
            let end = i + 2 + rel + 1;
            tokens.push(Token {
                start,
                end,
                text: chars[start..end].iter().collect(),
                quoted: true,
            });
            i = end;
            continue;
        }
        while i < n && !chars[i].is_whitespace() {
            i += 1;
        }
        tokens.push(Token {
            start,
            end: i,
            text: chars[start..i].iter().collect(),
            quoted: false,
        });
    }
    tokens
}

fn parse_priority(word: &str) -> Option<Priority> {
    let mut chars = word.chars();
    let (p, digit, rest) = (chars.next()?, chars.next()?, chars.next());
    if !p.eq_ignore_ascii_case(&'p') || rest.is_some() {
        return None;
    }
    let n = digit.to_digit(10).filter(|_| digit.is_ascii_digit())?;
    Priority::try_from(n as u8).ok()
}

/// A date at `tokens[i]` (or the two-word English form `next <day|week>`).
/// Returns the resolved date and how many tokens it used.
fn date_at(tokens: &[Token], i: usize, today: NaiveDate) -> Option<(NaiveDate, usize)> {
    let tok = &tokens[i];
    if tok.text.eq_ignore_ascii_case("next")
        && let Some(next) = tokens.get(i + 1)
        && let Some(rel) = parse_date_word(&format!("{} {}", tok.text, next.text))
    {
        return resolve(rel, today).map(|date| (date, 2));
    }
    let rel = parse_date_word(&tok.text)?;
    resolve(rel, today).map(|date| (date, 1))
}

/// A recurrence phrase starting at `tokens[i]`: its RRULE and how many tokens it used.
fn recurrence_at(tokens: &[Token], i: usize) -> Option<(String, usize)> {
    let words: Vec<&str> = tokens[i..].iter().map(|t| t.text.as_str()).collect();
    parse_recurrence(&words)
}

pub fn parse(
    text: &str,
    today: NaiveDate,
    known_projects: &[String],
    _known_labels: &[String],
) -> QuickAddResult {
    let tokens = tokenize(text);
    let mut result = QuickAddResult {
        title: String::new(),
        due: None,
        due_time: None,
        rrule: None,
        priority: None,
        project: None,
        labels: Vec::new(),
        spans: Vec::new(),
    };
    let mut title_words: Vec<&str> = Vec::new();
    // True when the previous token was an accepted date or recurrence, so a time word may
    // follow.
    let mut after_date = false;
    let mut i = 0;
    while i < tokens.len() {
        let tok = &tokens[i];
        let span = |end: usize, kind| Span {
            start: tok.start,
            end,
            kind,
        };
        let was_after_date = std::mem::replace(&mut after_date, false);

        if tok.text.starts_with('#') {
            let name: &str = if tok.quoted {
                &tok.text[2..tok.text.len() - 1]
            } else {
                &tok.text[1..]
            };
            if !name.is_empty() && known_projects.iter().any(|p| p == name) {
                result.project = Some(name.to_string());
                result.spans.push(span(tok.end, TokenKind::Project));
            } else {
                title_words.push(&tok.text);
            }
        } else if let Some(name) = tok.text.strip_prefix('@').filter(|n| !n.is_empty()) {
            if !result.labels.iter().any(|l| l == name) {
                result.labels.push(name.to_string());
            }
            result.spans.push(span(tok.end, TokenKind::Label));
        } else if let Some((rrule, used)) = recurrence_at(&tokens, i) {
            let last = &tokens[i + used - 1];
            result.rrule = Some(rrule);
            result.spans.push(span(last.end, TokenKind::Recurrence));
            // A time may follow (ゴミ出し 毎週火曜 8:00).
            after_date = true;
            i += used;
            continue;
        } else if let Some(p) = parse_priority(&tok.text) {
            result.priority = Some(p);
            result.spans.push(span(tok.end, TokenKind::Priority));
        } else if let Some((date, used)) = date_at(&tokens, i, today) {
            let last = &tokens[i + used - 1];
            result.due = Some(date);
            // A new date replaces the earlier date together with its time.
            result.due_time = None;
            result.spans.push(span(last.end, TokenKind::Date));
            after_date = true;
            i += used;
            continue;
        } else if was_after_date && let Some(time) = parse_time_word(&tok.text) {
            result.due_time = Some(time);
            result.spans.push(span(tok.end, TokenKind::Time));
        } else {
            title_words.push(&tok.text);
        }
        i += 1;
    }

    let title = title_words.join(" ");
    result.title = if title.is_empty() {
        text.trim().to_string()
    } else {
        title
    };
    result
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

    fn sp(start: usize, end: usize, kind: TokenKind) -> Span {
        Span { start, end, kind }
    }

    fn strs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// 2026-10-13 is a Tuesday.
    fn case(text: &str, today: &str, projects: &[&str], labels: &[&str]) -> QuickAddResult {
        parse(text, d(today), &strs(projects), &strs(labels))
    }

    fn run(text: &str) -> QuickAddResult {
        case(text, "2026-10-13", &["買い物", "家 の こと", "Work"], &[])
    }

    #[test]
    fn full_example_with_four_spans() {
        let r = run("買い物 明日 p1 #買い物 @急ぎ");
        assert_eq!(r.title, "買い物");
        assert_eq!(r.due, Some(d("2026-10-14")));
        assert_eq!(r.due_time, None);
        assert_eq!(r.priority, Some(Priority(1)));
        assert_eq!(r.project.as_deref(), Some("買い物"));
        assert_eq!(r.labels, strs(&["急ぎ"]));
        assert_eq!(
            r.spans,
            vec![
                sp(4, 6, TokenKind::Date),
                sp(7, 9, TokenKind::Priority),
                sp(10, 14, TokenKind::Project),
                sp(15, 18, TokenKind::Label),
            ]
        );
    }

    #[test]
    fn japanese_weekday_with_time() {
        let r = run("牛乳と卵を買う 来週月曜 15:00");
        assert_eq!(r.title, "牛乳と卵を買う");
        assert_eq!(r.due, Some(d("2026-10-19")));
        assert_eq!(r.due_time, Some(t(15, 0)));
        assert_eq!(
            r.spans,
            vec![sp(8, 12, TokenKind::Date), sp(13, 18, TokenKind::Time)]
        );
    }

    #[test]
    fn english_with_pm_and_priority() {
        let r = run("report tomorrow 3pm p2");
        assert_eq!(r.title, "report");
        assert_eq!(r.due, Some(d("2026-10-14")));
        assert_eq!(r.due_time, Some(t(15, 0)));
        assert_eq!(r.priority, Some(Priority(2)));
    }

    #[test]
    fn unknown_project_stays_in_title() {
        let r = run("#存在しない タスク");
        assert_eq!(r.project, None);
        assert_eq!(r.title, "#存在しない タスク");
        assert!(r.spans.is_empty());
    }

    #[test]
    fn later_priority_wins() {
        let r = run("p1 p3 タスク");
        assert_eq!(r.priority, Some(Priority(3)));
        assert_eq!(r.title, "タスク");
        assert_eq!(r.spans.len(), 2);
    }

    #[test]
    fn labels_in_order() {
        let r = run("@a @b x");
        assert_eq!(r.labels, strs(&["a", "b"]));
        assert_eq!(r.title, "x");
    }

    #[test]
    fn blank_input_is_empty_everything() {
        let r = run("   ");
        assert_eq!(r.title, "");
        assert_eq!(r.due, None);
        assert_eq!(r.due_time, None);
        assert_eq!(r.priority, None);
        assert_eq!(r.project, None);
        assert!(r.labels.is_empty());
        assert!(r.spans.is_empty());
    }

    #[test]
    fn all_tokens_title_falls_back_to_input() {
        let r = run("明日");
        assert_eq!(r.title, "明日");
        assert_eq!(r.due, Some(d("2026-10-14")));
        assert_eq!(r.spans, vec![sp(0, 2, TokenKind::Date)]);
    }

    #[test]
    fn all_tokens_fallback_is_trimmed_original() {
        let r = run("  明日   p1  ");
        assert_eq!(r.title, "明日   p1");
        assert_eq!(r.priority, Some(Priority(1)));
    }

    #[test]
    fn japanese_time_with_minutes() {
        let r = run("10/20 15時30分 歯医者");
        assert_eq!(r.title, "歯医者");
        assert_eq!(r.due, Some(d("2026-10-20")));
        assert_eq!(r.due_time, Some(t(15, 30)));
    }

    #[test]
    fn quoted_project_with_spaces() {
        let r = run("#\"家 の こと\" 掃除");
        assert_eq!(r.project.as_deref(), Some("家 の こと"));
        assert_eq!(r.title, "掃除");
        assert_eq!(r.spans, vec![sp(0, 9, TokenKind::Project)]);
    }

    #[test]
    fn unknown_quoted_project_stays_in_title() {
        let r = run("#\"ない 名前\" 掃除");
        assert_eq!(r.project, None);
        assert_eq!(r.title, "#\"ない 名前\" 掃除");
    }

    #[test]
    fn unterminated_quote_is_plain_word() {
        let r = run("#\"unterminated 家 掃除");
        assert_eq!(r.project, None);
        assert_eq!(r.title, "#\"unterminated 家 掃除");
        assert!(r.spans.is_empty());
    }

    #[test]
    fn lone_time_stays_in_title() {
        let r = run("会議 15:00");
        assert_eq!(r.due, None);
        assert_eq!(r.due_time, None);
        assert_eq!(r.title, "会議 15:00");
        assert!(r.spans.is_empty());
    }

    #[test]
    fn time_not_adjacent_to_date_stays_in_title() {
        let r = run("明日 会議 15:00");
        assert_eq!(r.due, Some(d("2026-10-14")));
        assert_eq!(r.due_time, None);
        assert_eq!(r.title, "会議 15:00");
    }

    #[test]
    fn duplicate_label_is_deduped() {
        let r = run("@a @a x @a");
        assert_eq!(r.labels, strs(&["a"]));
        assert_eq!(r.title, "x");
        assert_eq!(r.spans.len(), 3);
    }

    #[test]
    fn feb_29_in_non_leap_year_stays_in_title() {
        let r = case("2/29 飲み会", "2027-02-10", &[], &[]);
        assert_eq!(r.due, None);
        assert_eq!(r.title, "2/29 飲み会");
        assert!(r.spans.is_empty());
    }

    #[test]
    fn feb_29_in_leap_year_resolves() {
        let r = case("2/29 飲み会", "2028-02-10", &[], &[]);
        assert_eq!(r.due, Some(d("2028-02-29")));
        assert_eq!(r.title, "飲み会");
    }

    #[test]
    fn extra_and_edge_whitespace_collapses() {
        let r = run("  買い物    明日   p1  ");
        assert_eq!(r.title, "買い物");
        assert_eq!(
            r.spans,
            vec![sp(9, 11, TokenKind::Date), sp(14, 16, TokenKind::Priority)]
        );
    }

    #[test]
    fn full_width_space_separates() {
        let r = run("買い物　明日　p1");
        assert_eq!(r.title, "買い物");
        assert_eq!(r.due, Some(d("2026-10-14")));
        assert_eq!(r.priority, Some(Priority(1)));
        assert_eq!(
            r.spans,
            vec![sp(4, 6, TokenKind::Date), sp(7, 9, TokenKind::Priority)]
        );
    }

    #[test]
    fn priority_is_case_insensitive_and_bounded() {
        let r = run("P2 x");
        assert_eq!(r.priority, Some(Priority(2)));
        let r = run("P5 x");
        assert_eq!(r.priority, None);
        assert_eq!(r.title, "P5 x");
        let r = run("p0 x");
        assert_eq!(r.priority, None);
    }

    #[test]
    fn later_date_wins_and_drops_earlier_time() {
        let r = run("x 明日 10:00 来週月曜");
        assert_eq!(r.due, Some(d("2026-10-19")));
        assert_eq!(r.due_time, None);
        assert_eq!(r.title, "x");
        assert_eq!(r.spans.len(), 3);
    }

    #[test]
    fn later_project_wins() {
        let r = run("#買い物 #Work x");
        assert_eq!(r.project.as_deref(), Some("Work"));
        assert_eq!(r.title, "x");
    }

    #[test]
    fn unknown_label_is_still_a_label() {
        let r = case("x @新しい", "2026-10-13", &[], &["急ぎ"]);
        assert_eq!(r.labels, strs(&["新しい"]));
    }

    #[test]
    fn bare_hash_and_at_stay_in_title() {
        let r = run("# @ x");
        assert_eq!(r.title, "# @ x");
        assert!(r.spans.is_empty());
    }

    #[test]
    fn english_next_weekday_spans_two_tokens() {
        let r = run("call next mon 9:30");
        assert_eq!(r.title, "call");
        assert_eq!(r.due, Some(d("2026-10-19")));
        assert_eq!(r.due_time, Some(t(9, 30)));
        assert_eq!(
            r.spans,
            vec![sp(5, 13, TokenKind::Date), sp(14, 18, TokenKind::Time)]
        );
    }

    #[test]
    fn mixed_japanese_english_and_iso_date() {
        let r = run("deploy 2026-12-01 午後3時 p1 @ops #Work");
        assert_eq!(r.title, "deploy");
        assert_eq!(r.due, Some(d("2026-12-01")));
        assert_eq!(r.due_time, Some(t(15, 0)));
        assert_eq!(r.project.as_deref(), Some("Work"));
        assert_eq!(r.labels, strs(&["ops"]));
    }

    #[test]
    fn span_offsets_are_chars_not_bytes() {
        // 明日 is 2 chars (6 bytes); the label starts after "歯医者 明日 ".
        let r = run("歯医者 明日 @通院");
        assert_eq!(
            r.spans,
            vec![sp(4, 6, TokenKind::Date), sp(7, 10, TokenKind::Label)]
        );
    }

    #[test]
    fn quoted_project_span_after_fullwidth_space() {
        let r = run("掃除　#\"家 の こと\"");
        assert_eq!(r.title, "掃除");
        assert_eq!(r.spans, vec![sp(3, 12, TokenKind::Project)]);
    }

    #[test]
    fn serializes_camel_case() {
        let r = run("x 明日 15:00");
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["due"], "2026-10-14");
        assert_eq!(v["dueTime"], "15:00");
        assert_eq!(v["spans"][0]["kind"], "date");
        let none = serde_json::to_value(run("x")).unwrap();
        assert!(none["dueTime"].is_null());
    }

    #[test]
    fn recurrence_words_are_parsed_and_removed_from_the_title() {
        let r = run("ゴミ出し 毎週火曜 8:00");
        assert_eq!(r.title, "ゴミ出し");
        assert_eq!(r.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=TU"));
        // Parsing leaves `due` empty; the caller fills in the first occurrence.
        assert_eq!(r.due, None);
        // A time word right after the recurrence is read as the due time.
        assert_eq!(r.due_time, Some(t(8, 0)));
        assert!(r.spans.iter().any(|s| s.kind == TokenKind::Recurrence));
        let r = run("report every 2 weeks p1");
        assert_eq!(r.title, "report");
        assert_eq!(r.rrule.as_deref(), Some("FREQ=WEEKLY;INTERVAL=2"));
        assert_eq!(r.priority, Some(Priority(1)));
    }

    #[test]
    fn project_and_label_tokens_are_never_recurrence() {
        let r = run("#every @every x");
        assert_eq!(r.rrule, None);
        assert_eq!(r.labels, strs(&["every"]));
    }
}
