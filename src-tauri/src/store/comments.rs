//! Comments of a task (spec ① §3): app-only JSON Lines, one file per task at `_comments/<project>.<No>.jsonl`.
//! A line is an event (add / edit / delete); files are only appended to, and two sides merge by line id.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Add,
    Edit,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Line {
    pub id: String,
    pub op: Op,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub at: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub at: String,
    pub author: String,
    pub text: String,
    pub edited: bool,
}

pub const DIR: &str = "_comments";

/// `仕事.12.jsonl`.
pub fn file_name(project: &str, no: u32) -> String {
    format!("{project}.{no}.jsonl")
}

/// The inverse of [`file_name`]. A project name may contain dots, so the No. is the last dotted part.
pub fn parse_file_name(name: &str) -> Option<(String, u32)> {
    let stem = name.strip_suffix(".jsonl")?;
    let (project, no) = stem.rsplit_once('.')?;
    if project.is_empty() || crate::store::paths::validate_project_name(project).is_err() {
        return None;
    }
    let no: u32 = no.parse().ok()?;
    Some((project.to_string(), no))
}

/// The lines that read; a broken line is skipped (the others still count).
pub fn parse(text: &str) -> Vec<Line> {
    text.lines()
        .filter_map(|l| serde_json::from_str::<Line>(l).ok())
        .collect()
}

/// The comments the lines describe, in id order: `add` creates one, `edit` replaces its text, `delete` removes it.
/// An edit or delete of a comment that is not there is skipped.
pub fn view(lines: &[Line]) -> Vec<Comment> {
    let mut sorted: Vec<&Line> = lines.iter().collect();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    let mut by_id: BTreeMap<String, Comment> = BTreeMap::new();
    for l in sorted {
        match l.op {
            Op::Add => {
                by_id.entry(l.id.clone()).or_insert_with(|| Comment {
                    id: l.id.clone(),
                    at: l.at.clone(),
                    author: l.author.clone(),
                    text: l.text.clone().unwrap_or_default(),
                    edited: false,
                });
            }
            Op::Edit => {
                if let Some(c) = l.target.as_ref().and_then(|t| by_id.get_mut(t)) {
                    c.text = l.text.clone().unwrap_or_default();
                    c.edited = true;
                }
            }
            Op::Delete => {
                if let Some(t) = &l.target {
                    by_id.remove(t);
                }
            }
        }
    }
    by_id.into_values().collect()
}

/// Both sides' lines, one per id, in id order (with a trailing newline). Two different lines with one id keep
/// the smaller text, so the result does not depend on which side is which.
pub fn merge(a: &str, b: &str) -> String {
    let mut by_id: BTreeMap<String, String> = BTreeMap::new();
    for raw in a.lines().chain(b.lines()) {
        let Ok(line) = serde_json::from_str::<Line>(raw) else {
            continue;
        };
        by_id
            .entry(line.id)
            .and_modify(|cur| {
                if raw < cur.as_str() {
                    *cur = raw.to_string();
                }
            })
            .or_insert_with(|| raw.to_string());
    }
    by_id.into_values().map(|l| l + "\n").collect()
}

/// An id that sorts by time: milliseconds since the epoch, then 64 random bits.
pub fn new_id(now_ms: u64) -> String {
    format!("{now_ms:013}-{:016x}", rand::random::<u64>())
}

/// One line of the file, with its newline.
pub fn to_line(line: &Line) -> String {
    serde_json::to_string(line).expect("a Line always serializes") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add(id: &str, text: &str) -> Line {
        Line {
            id: id.into(),
            op: Op::Add,
            target: None,
            at: "2026-10-25T21:04:05+09:00".into(),
            author: "たろう".into(),
            text: Some(text.into()),
        }
    }

    #[test]
    fn file_names_round_trip_with_dots_in_the_project() {
        assert_eq!(file_name("仕事", 12), "仕事.12.jsonl");
        assert_eq!(parse_file_name("a.b.3.jsonl"), Some(("a.b".into(), 3)));
        assert_eq!(parse_file_name("仕事.x.jsonl"), None);
        assert_eq!(parse_file_name("仕事.12.json"), None);
        assert_eq!(parse_file_name(".12.jsonl"), None);
    }

    #[test]
    fn view_applies_edits_and_deletes_in_id_order() {
        let mut e = Line {
            id: "0003".into(),
            op: Op::Edit,
            target: Some("0001".into()),
            at: "t".into(),
            author: "たろう".into(),
            text: Some("直した".into()),
        };
        let d = Line {
            id: "0004".into(),
            op: Op::Delete,
            target: Some("0002".into()),
            at: "t".into(),
            author: "たろう".into(),
            text: None,
        };
        let v = view(&[
            d.clone(),
            add("0002", "消す"),
            e.clone(),
            add("0001", "最初"),
        ]);
        assert_eq!(v.len(), 1);
        assert_eq!(
            (v[0].id.as_str(), v[0].text.as_str(), v[0].edited),
            ("0001", "直した", true)
        );
        e.target = Some("9999".into());
        assert_eq!(
            view(&[add("0001", "最初"), e])[0].text,
            "最初",
            "an edit of a missing comment is skipped"
        );
    }

    #[test]
    fn parse_skips_broken_lines() {
        let text = format!(
            "{}not json\n{}",
            to_line(&add("0001", "a")),
            to_line(&add("0002", "b"))
        );
        assert_eq!(parse(&text).len(), 2);
    }

    #[test]
    fn merge_unions_by_id_in_id_order() {
        let a = format!(
            "{}{}",
            to_line(&add("0001", "a")),
            to_line(&add("0003", "c"))
        );
        let b = format!(
            "{}{}",
            to_line(&add("0002", "b")),
            to_line(&add("0003", "c"))
        );
        let m = merge(&a, &b);
        let ids: Vec<String> = parse(&m).into_iter().map(|l| l.id).collect();
        assert_eq!(ids, ["0001", "0002", "0003"]);
        assert_eq!(
            merge(&a, &b),
            merge(&b, &a),
            "order of sides does not matter"
        );
    }

    #[test]
    fn merge_same_id_keeps_one() {
        let a = to_line(&add("0001", "a"));
        let b = to_line(&add("0001", "b"));
        let m = merge(&a, &b);
        assert_eq!(parse(&m).len(), 1);
        assert_eq!(m, merge(&b, &a));
    }

    #[test]
    fn new_ids_sort_by_time() {
        let x = new_id(1_000);
        let y = new_id(2_000);
        assert!(x < y);
        assert_ne!(new_id(1_000), new_id(1_000));
    }
}
