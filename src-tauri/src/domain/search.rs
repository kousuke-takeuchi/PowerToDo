//! Search over every task (仕様 §3.4). Pure. Matching is on a normalized form so that width,
//! case and katakana / hiragana differences do not matter.

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use super::model::Task;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Matched {
    Title,
    Note,
    Label,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub task: Task,
    pub matched: Matched,
}

/// NFKC (full-width -> ASCII, half-width katakana -> full-width), lower case, katakana -> hiragana.
/// The long sound mark (ー) and everything else stay as they are.
pub fn normalize(s: &str) -> String {
    s.nfkc()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            '\u{30A1}'..='\u{30F6}' => char::from_u32(c as u32 - 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// Words are separated by any whitespace (NFKC turns a full-width space into a plain one).
fn words(query: &str) -> Vec<String> {
    normalize(query)
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

fn where_matched(t: &Task, words: &[String]) -> Option<Matched> {
    let title = normalize(&t.title);
    let note = t.note.as_deref().map(normalize).unwrap_or_default();
    let labels: Vec<String> = t.labels.iter().map(|l| normalize(l)).collect();
    let hit_title = |w: &String| title.contains(w.as_str());
    let hit_note = |w: &String| note.contains(w.as_str());
    let hit_label = |w: &String| labels.iter().any(|l| l.contains(w.as_str()));
    // AND across fields: every word must hit the title, the note or some label.
    if !words
        .iter()
        .all(|w| hit_title(w) || hit_note(w) || hit_label(w))
    {
        return None;
    }
    // Report the field that holds the whole query if there is one, else the first field
    // (title > note > label) that holds at least one word.
    if words.iter().all(hit_title) {
        Some(Matched::Title)
    } else if words.iter().all(hit_note) {
        Some(Matched::Note)
    } else if words.iter().all(hit_label) {
        Some(Matched::Label)
    } else if words.iter().any(hit_title) {
        Some(Matched::Title)
    } else if words.iter().any(hit_note) {
        Some(Matched::Note)
    } else {
        Some(Matched::Label)
    }
}

/// Every word must appear somewhere in the task (title, note or a label; different words may be
/// in different fields). `matched` is the field holding all words, else the first of title,
/// note, label holding at least one. Ordered: title hits, then note, then label; inside a group
/// by due date (none last), then No. At most `limit` hits.
pub fn search(tasks: &[Task], query: &str, include_done: bool, limit: usize) -> Vec<Hit> {
    let words = words(query);
    if words.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<Hit> = tasks
        .iter()
        .filter(|t| include_done || t.progress < 100)
        .filter_map(|t| {
            where_matched(t, &words).map(|matched| Hit {
                task: t.clone(),
                matched,
            })
        })
        .collect();
    hits.sort_by(|a, b| {
        let key = |h: &Hit| (h.matched, h.task.due.is_none(), h.task.due, h.task.no);
        key(a).cmp(&key(b))
    });
    hits.truncate(limit);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Priority;
    use chrono::{NaiveDate, NaiveDateTime};

    fn task(
        no: u32,
        title: &str,
        note: Option<&str>,
        labels: &[&str],
        due: Option<&str>,
        progress: u8,
    ) -> Task {
        Task {
            no,
            project: "p".into(),
            category: None,
            title: title.into(),
            assignee: String::new(),
            priority: Priority(4),
            progress,
            start: None,
            due: due.map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()),
            due_time: None,
            days: None,
            note: note.map(Into::into),
            parent_no: None,
            labels: labels.iter().map(|s| s.to_string()).collect(),
            rrule: None,
            rrule_label: None,
            reminders: vec![],
            order: 0,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    #[test]
    fn normalize_folds_width_case_and_kana() {
        assert_eq!(normalize("Ｍｉｌｋ"), "milk");
        assert_eq!(normalize("ギュウニュウ"), "ぎゅうにゅう");
        assert_eq!(normalize("ｶﾞ"), "が"); // half-width katakana + voiced mark -> NFKC "ガ" -> hiragana
        assert_eq!(normalize("コーヒー"), "こーひー"); // long mark kept
    }

    #[test]
    fn search_matches_title_note_label_in_that_order() {
        let tasks = vec![
            task(1, "買い物リスト", Some("ギュウニュウ"), &[], None, 0),
            task(2, "ぎゅうにゅうを買う", None, &[], Some("2026-10-20"), 0),
            task(3, "朝食", None, &["ぎゅうにゅう"], None, 0),
            task(4, "ギュウニュウ (完了)", None, &[], None, 100),
            task(5, "パン", None, &[], None, 0),
        ];
        let hits = search(&tasks, "ギュウニュウ", false, 50);
        assert_eq!(
            hits.iter().map(|h| h.task.no).collect::<Vec<_>>(),
            vec![2, 1, 3]
        );
        assert_eq!(hits[0].matched, Matched::Title);
        assert_eq!(hits[1].matched, Matched::Note);
        assert_eq!(hits[2].matched, Matched::Label);
        let with_done = search(&tasks, "ぎゅうにゅう", true, 50);
        assert_eq!(
            with_done.iter().map(|h| h.task.no).collect::<Vec<_>>(),
            vec![2, 4, 1, 3]
        );
    }

    #[test]
    fn search_requires_every_word() {
        let tasks = vec![
            task(1, "牛乳と卵を買う", None, &[], None, 0),
            task(2, "牛乳 1L", None, &[], None, 0),
        ];
        let hits = search(&tasks, "牛乳　卵", false, 50); // full-width space separates words
        assert_eq!(hits.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn search_ignores_blank_query_and_respects_limit() {
        let tasks: Vec<Task> = (1..=5)
            .map(|i| task(i, "同じ名前", None, &[], None, 0))
            .collect();
        assert!(search(&tasks, "   ", false, 50).is_empty());
        assert!(search(&tasks, "", false, 50).is_empty());
        assert_eq!(search(&tasks, "同じ", false, 3).len(), 3);
    }

    #[test]
    fn search_and_spans_fields() {
        let tasks = vec![
            task(1, "牛乳を買う", None, &["急ぎ"], None, 0),
            task(2, "牛乳", Some("卵"), &[], None, 0),
            task(3, "パン", Some("卵"), &[], None, 0),
        ];
        let hits = search(&tasks, "牛乳 急ぎ", false, 50);
        assert_eq!(hits.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![1]);
        assert_eq!(hits[0].matched, Matched::Title);
        let hits = search(&tasks, "牛乳 卵", false, 50);
        assert_eq!(hits.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![2]);
        assert_eq!(hits[0].matched, Matched::Title);
    }
}
