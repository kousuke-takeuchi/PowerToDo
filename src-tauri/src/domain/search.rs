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
    let in_title = words.iter().all(|w| title.contains(w.as_str()));
    let in_note = !note.is_empty() && words.iter().all(|w| note.contains(w.as_str()));
    let in_labels = words
        .iter()
        .all(|w| labels.iter().any(|l| l.contains(w.as_str())));
    if in_title {
        Some(Matched::Title)
    } else if in_note {
        Some(Matched::Note)
    } else if in_labels {
        Some(Matched::Label)
    } else {
        None
    }
}

/// Every word must appear in one field (title, note or a label). Ordered: title hits, then
/// note, then label; inside a group by due date (none last), then No. At most `limit` hits.
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

    fn task(no: u32, title: &str, note: Option<&str>, labels: &[&str], due: Option<&str>, progress: u8) -> Task {
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
        assert_eq!(hits.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![2, 1, 3]);
        assert!(matches!(hits[0].matched, Matched::Title));
        assert!(matches!(hits[1].matched, Matched::Note));
        assert!(matches!(hits[2].matched, Matched::Label));
        let with_done = search(&tasks, "ぎゅうにゅう", true, 50);
        assert_eq!(with_done.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![2, 4, 1, 3]);
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
        let tasks: Vec<Task> = (1..=5).map(|i| task(i, "同じ名前", None, &[], None, 0)).collect();
        assert!(search(&tasks, "   ", false, 50).is_empty());
        assert!(search(&tasks, "", false, 50).is_empty());
        assert_eq!(search(&tasks, "同じ", false, 3).len(), 3);
    }
}
