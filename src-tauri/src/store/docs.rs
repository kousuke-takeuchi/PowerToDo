//! Project documents (spec project docs §データ): `_docs/<project>.<id>.md`, a front matter of
//! `key: value` lines and a Markdown body. Values are written as JSON strings (a JSON string is a YAML
//! double-quoted scalar), so any title survives; plain values written by hand are read as text.
//! `files` holds one JSON object per `  - ` line (a YAML flow mapping). Unknown lines are kept.

use serde::Serialize;

use crate::store::attachments::AttachmentInfo;

pub const DIR: &str = "_docs";
pub const UNTITLED: &str = "無題";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Doc {
    pub id: String,
    pub project: String,
    pub title: String,
    pub section: Option<String>,
    pub created: String,
    pub updated: String,
    pub author: String,
    pub files: Vec<AttachmentInfo>,
    pub body: String,
    /// Front matter lines this version does not know, written back as they were.
    #[serde(skip)]
    pub extra: Vec<String>,
}

pub fn new_id(now_ms: u64) -> String {
    crate::store::comments::new_id(now_ms)
}

fn is_id(s: &str) -> bool {
    let Some((ms, rnd)) = s.split_once('-') else { return false };
    ms.len() == 13
        && ms.bytes().all(|b| b.is_ascii_digit())
        && rnd.len() == 16
        && rnd.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `仕事.1792929845000-3f2a….md`.
pub fn file_name(project: &str, id: &str) -> String {
    format!("{project}.{id}.md")
}

/// The inverse of [`file_name`]; the id is the last dotted part (a project name may contain dots).
pub fn parse_file_name(name: &str) -> Option<(String, String)> {
    let stem = name.strip_suffix(".md")?;
    let (project, id) = stem.rsplit_once('.')?;
    if project.is_empty() || !is_id(id) || crate::store::paths::validate_project_name(project).is_err() {
        return None;
    }
    Some((project.to_string(), id.to_string()))
}

fn value(raw: &str) -> String {
    let raw = raw.trim();
    if raw.starts_with('"')
        && let Ok(s) = serde_json::from_str::<String>(raw)
    {
        return s;
    }
    raw.to_string()
}

fn quoted(s: &str) -> String {
    serde_json::to_string(s).expect("a string serializes")
}

pub fn parse(project: &str, id: &str, text: &str) -> Doc {
    let mut doc = Doc {
        id: id.to_string(),
        project: project.to_string(),
        title: UNTITLED.to_string(),
        section: None,
        created: String::new(),
        updated: String::new(),
        author: String::new(),
        files: Vec::new(),
        body: text.to_string(),
        extra: Vec::new(),
    };
    let Some(rest) = text.strip_prefix("---\n") else { return doc };
    let Some(end) = rest.find("\n---\n").map(|i| (i, i + 5)).or_else(|| {
        rest.strip_suffix("\n---").map(|r| (r.len(), rest.len()))
    }) else {
        return doc;
    };
    let (head, body) = (&rest[..end.0], &rest[end.1..]);
    doc.body = body.strip_prefix('\n').unwrap_or(body).to_string();
    let mut in_files = false;
    for line in head.lines() {
        if in_files {
            if let Some(item) = line.trim_start().strip_prefix("- ") {
                if let Ok(f) = serde_json::from_str::<AttachmentInfo>(item.trim()) {
                    doc.files.push(f);
                }
                continue;
            }
            in_files = false;
        }
        let Some((k, v)) = line.split_once(':') else {
            doc.extra.push(line.to_string());
            continue;
        };
        match k.trim() {
            "title" => doc.title = value(v),
            "section" => doc.section = Some(value(v)).filter(|s| !s.is_empty()),
            "created" => doc.created = value(v),
            "updated" => doc.updated = value(v),
            "author" => doc.author = value(v),
            "files" => in_files = true,
            _ => doc.extra.push(line.to_string()),
        }
    }
    doc
}

pub fn render(doc: &Doc) -> String {
    let mut out = String::from("---\n");
    out += &format!("title: {}\n", quoted(&doc.title));
    if let Some(s) = doc.section.as_deref().filter(|s| !s.is_empty()) {
        out += &format!("section: {}\n", quoted(s));
    }
    for (k, v) in [("created", &doc.created), ("updated", &doc.updated), ("author", &doc.author)] {
        if !v.is_empty() {
            out += &format!("{k}: {}\n", quoted(v));
        }
    }
    for line in &doc.extra {
        out += line;
        out.push('\n');
    }
    if !doc.files.is_empty() {
        out += "files:\n";
        for f in &doc.files {
            out += &format!("  - {}\n", serde_json::to_string(f).expect("a file serializes"));
        }
    }
    out += "---\n\n";
    out += &doc.body;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "1792929845000-3f2a00000000009c";

    #[test]
    fn file_names_round_trip_with_dots_in_the_project() {
        let n = file_name("v1.2 リリース", ID);
        assert_eq!(n, format!("v1.2 リリース.{ID}.md"));
        assert_eq!(parse_file_name(&n), Some(("v1.2 リリース".into(), ID.into())));
        assert_eq!(parse_file_name("仕事.12.jsonl"), None);
        assert_eq!(parse_file_name("仕事.notanid.md"), None);
        assert_eq!(parse_file_name(&format!(".{ID}.md")), None);
    }

    #[test]
    fn front_matter_round_trips_and_keeps_unknown_keys() {
        let text = format!(
            "---\ntitle: \"在庫: \\\"案\\\" #1\"\nsection: 在庫アプリ\ncreated: 2026-11-28T10:00:00+09:00\nupdated: 2026-11-28T10:20:00+09:00\nauthor: たろう\ncolor: blue\nfiles:\n  - {{\"hash\":\"{h}\",\"ext\":\"pdf\",\"name\":\"見積もり.pdf\",\"type\":\"application/pdf\",\"size\":52011}}\n---\n\n## 目的\n\n本文\n",
            h = "a".repeat(64)
        );
        let d = parse("仕事", ID, &text);
        assert_eq!(d.title, "在庫: \"案\" #1");
        assert_eq!(d.section.as_deref(), Some("在庫アプリ"));
        assert_eq!(d.author, "たろう");
        assert_eq!(d.files.len(), 1);
        assert_eq!(d.files[0].name, "見積もり.pdf");
        assert_eq!(d.body, "## 目的\n\n本文\n");
        let again = parse("仕事", ID, &render(&d));
        assert_eq!(again.title, d.title);
        assert_eq!(again.files, d.files);
        assert_eq!(again.body, d.body);
        assert!(render(&d).contains("\ncolor: blue\n"));
    }

    #[test]
    fn a_title_with_leading_space_and_newline_survives() {
        let mut d = parse("仕事", ID, "");
        d.title = "  二行\nの題名".into();
        assert_eq!(parse("仕事", ID, &render(&d)).title, "  二行\nの題名");
    }

    #[test]
    fn empty_section_is_the_whole_project() {
        let d = parse("仕事", ID, "---\ntitle: a\nsection:\n---\nx\n");
        assert_eq!(d.section, None);
        assert!(!render(&d).contains("section:"));
    }

    #[test]
    fn a_file_without_front_matter_is_all_body_titled_by_its_id() {
        let d = parse("仕事", ID, "# 見出し\n\n本文\n");
        assert_eq!(d.title, "無題");
        assert_eq!(d.body, "# 見出し\n\n本文\n");
        assert!(render(&d).starts_with("---\ntitle: \"無題\"\n"));
    }

    #[test]
    fn an_unclosed_front_matter_is_body() {
        let d = parse("仕事", ID, "---\ntitle: a\n本文\n");
        assert_eq!(d.title, "無題");
        assert_eq!(d.body, "---\ntitle: a\n本文\n");
    }
}
