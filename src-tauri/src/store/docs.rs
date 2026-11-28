//! Project documents (spec project docs §データ): `_docs/<project>.<id>.md`, a front matter of
//! `key: value` lines and a Markdown body. Values are written as JSON strings (a JSON string is a YAML
//! double-quoted scalar), so any title survives; plain values written by hand are read as text.
//! `files` holds one JSON object per `  - ` line (a YAML flow mapping). Unknown lines are kept; list
//! lines under `files:` that do not parse (and their indented continuations) are written back there.
//! A leading BOM and CRLF line ends are read as plain `\n` text and written as `\n`.

use std::path::PathBuf;

use chrono::{DateTime, FixedOffset, NaiveDateTime};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::store::attachments::AttachmentInfo;
use crate::store::paths::{Paths, validate_project_name, write_atomic};

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
    /// Lines of the `files:` list that do not parse as an attachment, written back after `files`.
    #[serde(skip)]
    pub files_extra: Vec<String>,
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
        body: String::new(),
        extra: Vec::new(),
        files_extra: Vec::new(),
    };
    let text = text.strip_prefix('\u{feff}').unwrap_or(text).replace("\r\n", "\n");
    let Some(rest) = text.strip_prefix("---\n") else {
        doc.body = text;
        return doc;
    };
    let end = if rest.starts_with("---\n") {
        Some((0, 4))
    } else if rest == "---" {
        Some((0, 3))
    } else {
        rest.find("\n---\n")
            .map(|i| (i, i + 5))
            .or_else(|| rest.strip_suffix("\n---").map(|r| (r.len(), rest.len())))
    };
    let Some(end) = end else {
        doc.body = text;
        return doc;
    };
    let (head, body) = (&rest[..end.0], &rest[end.1..]);
    doc.body = body.strip_prefix('\n').unwrap_or(body).to_string();
    let mut in_files = false;
    for line in head.lines() {
        if in_files {
            let t = line.trim_start();
            if t == "-" || t.starts_with("- ") {
                match serde_json::from_str::<AttachmentInfo>(t[1..].trim()) {
                    Ok(f) => doc.files.push(f),
                    Err(_) => doc.files_extra.push(line.to_string()),
                }
                continue;
            }
            if !t.is_empty() && t.len() < line.len() {
                // An indented continuation of a block-style entry.
                doc.files_extra.push(line.to_string());
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
    if !doc.files.is_empty() || !doc.files_extra.is_empty() {
        out += "files:\n";
        for f in &doc.files {
            out += &format!("  - {}\n", serde_json::to_string(f).expect("a file serializes"));
        }
        for line in &doc.files_extra {
            out += line;
            out.push('\n');
        }
    }
    out += "---\n\n";
    out += &doc.body;
    out
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub id: String,
    pub project: String,
    pub title: String,
    pub section: Option<String>,
    pub updated: String,
    pub author: String,
    pub files: usize,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub title: Option<String>,
    /// `Some(None)` moves the document to the whole project.
    #[serde(default, deserialize_with = "some_nullable")]
    pub section: Option<Option<String>>,
    pub body: Option<String>,
    pub files: Option<Vec<AttachmentInfo>>,
}

/// Reads a present key (even `null`) as `Some(..)`; a missing key stays `None` through `default`.
fn some_nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum Saved {
    Written(Doc),
    Conflict { doc: Doc, copy: Doc },
    /// The document was archived or deleted meanwhile; the edit became a new document.
    Recreated { copy: Doc },
}

fn path(paths: &Paths, project: &str, id: &str) -> AppResult<PathBuf> {
    validate_project_name(project)?;
    if !is_id(id) {
        return Err(AppError::Invalid { message: "ドキュメントの ID が正しくありません".into() });
    }
    Ok(paths.docs_dir().join(file_name(project, id)))
}

fn stamp(now: DateTime<FixedOffset>) -> String {
    now.format("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

fn write(paths: &Paths, doc: &Doc) -> AppResult<()> {
    std::fs::create_dir_all(paths.docs_dir())?;
    write_atomic(&path(paths, &doc.project, &doc.id)?, render(doc).as_bytes())
}

/// The documents of `_docs/` as (project, id, path).
fn files(paths: &Paths) -> AppResult<Vec<(String, String, PathBuf)>> {
    let entries = match std::fs::read_dir(paths.docs_dir()) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let Ok(name) = entry.file_name().into_string() else { continue };
        if let Some((project, id)) = parse_file_name(&name) {
            out.push((project, id, entry.path()));
        }
    }
    Ok(out)
}

pub fn read(paths: &Paths, project: &str, id: &str) -> AppResult<Doc> {
    match std::fs::read_to_string(path(paths, project, id)?) {
        Ok(t) => Ok(parse(project, id, &t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(AppError::NotFound {
            message: "ドキュメントが見つかりません".into(),
        }),
        Err(e) => Err(e.into()),
    }
}

pub fn list(paths: &Paths, project: &str) -> AppResult<Vec<DocSummary>> {
    let mut out = Vec::new();
    for (pj, id, p) in files(paths)? {
        if pj != project {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let d = parse(&pj, &id, &text);
        out.push(DocSummary {
            id: d.id,
            project: d.project,
            title: d.title,
            section: d.section,
            updated: d.updated,
            author: d.author,
            files: d.files.len(),
        });
    }
    out.sort_by(|a, b| b.updated.cmp(&a.updated).then_with(|| b.id.cmp(&a.id)));
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
pub fn create(
    paths: &Paths,
    project: &str,
    section: Option<&str>,
    title: &str,
    body: &str,
    author: &str,
    now: DateTime<FixedOffset>,
    now_ms: u64,
) -> AppResult<Doc> {
    let title = title.trim();
    let doc = Doc {
        id: new_id(now_ms),
        project: project.to_string(),
        title: if title.is_empty() { UNTITLED.to_string() } else { title.to_string() },
        section: section.map(str::to_string).filter(|s| !s.is_empty()),
        created: stamp(now),
        updated: stamp(now),
        author: author.to_string(),
        files: Vec::new(),
        body: body.to_string(),
        extra: Vec::new(),
        files_extra: Vec::new(),
    };
    write(paths, &doc)?;
    Ok(doc)
}

/// Writes `loser` as a new document titled `<title> (競合 yyyy-mm-dd hhmm)`.
pub fn conflict_copy(
    paths: &Paths,
    project: &str,
    loser: &Doc,
    now: DateTime<FixedOffset>,
    now_ms: u64,
) -> AppResult<Doc> {
    let copy = Doc {
        id: new_id(now_ms),
        project: project.to_string(),
        title: format!("{} (競合 {})", loser.title, now.format("%Y-%m-%d %H%M")),
        ..loser.clone()
    };
    write(paths, &copy)?;
    Ok(copy)
}

/// Applies `edit` when the file is still the version the screen read (`base_updated`); otherwise the
/// file stays and the screen's version becomes a conflict copy (spec: an outside change while editing).
/// When the file is gone (archived or deleted meanwhile), the edit alone becomes a new conflict-titled document.
#[allow(clippy::too_many_arguments)]
pub fn save(
    paths: &Paths,
    project: &str,
    id: &str,
    base_updated: &str,
    edit: Edit,
    author: &str,
    now: DateTime<FixedOffset>,
    now_ms: u64,
) -> AppResult<Saved> {
    let current = match read(paths, project, id) {
        Ok(d) => d,
        Err(AppError::NotFound { .. }) => {
            let title = edit.title.as_deref().map(str::trim).unwrap_or("");
            let lost = Doc {
                id: id.to_string(),
                project: project.to_string(),
                title: if title.is_empty() { UNTITLED.to_string() } else { title.to_string() },
                section: edit.section.flatten().filter(|s| !s.is_empty()),
                created: stamp(now),
                updated: stamp(now),
                author: author.to_string(),
                files: edit.files.unwrap_or_default(),
                body: edit.body.unwrap_or_default(),
                extra: Vec::new(),
                files_extra: Vec::new(),
            };
            let copy = conflict_copy(paths, project, &lost, now, now_ms)?;
            return Ok(Saved::Recreated { copy });
        }
        Err(e) => return Err(e),
    };
    let mut next = current.clone();
    if let Some(t) = edit.title {
        let t = t.trim();
        next.title = if t.is_empty() { UNTITLED.to_string() } else { t.to_string() };
    }
    if let Some(s) = edit.section {
        next.section = s.filter(|s| !s.is_empty());
    }
    if let Some(b) = edit.body {
        next.body = b;
    }
    if let Some(f) = edit.files {
        next.files = f;
    }
    next.updated = stamp(now);
    next.author = author.to_string();
    if current.updated != base_updated {
        let copy = conflict_copy(paths, project, &next, now, now_ms)?;
        return Ok(Saved::Conflict { doc: current, copy });
    }
    write(paths, &next)?;
    Ok(Saved::Written(next))
}

/// Moves one document (`Some(id)`) or all of a project's into `archive/` as `<stem> (<YYYYMMDD-HHMM>).md`.
pub fn archive(paths: &Paths, project: &str, id: Option<&str>, now: NaiveDateTime) -> AppResult<()> {
    let tag = now.format("%Y%m%d-%H%M").to_string();
    for (pj, i, p) in files(paths)? {
        if pj != project || id.is_some_and(|x| x != i) {
            continue;
        }
        let dir = paths.archive_dir();
        std::fs::create_dir_all(&dir)?;
        let stem = format!("{pj}.{i}");
        let mut k = 1;
        let dest = loop {
            let name = if k == 1 { format!("{stem} ({tag}).md") } else { format!("{stem} ({tag}-{k}).md") };
            let d = dir.join(name);
            if !d.exists() {
                break d;
            }
            k += 1;
        };
        std::fs::rename(&p, dest)?;
    }
    Ok(())
}

/// Keeps going past a failing file (logged) so one bad file does not leave the rest behind; returns the first error.
fn first_error(first: &mut Option<AppError>, result: AppResult<()>, name: &str) {
    if let Err(e) = result {
        eprintln!("document {name} did not follow: {e}");
        first.get_or_insert(e);
    }
}

pub fn rename_project(paths: &Paths, from: &str, to: &str) -> AppResult<()> {
    let mut first = None;
    for (pj, id, p) in files(paths)? {
        if pj == from {
            let r = path(paths, to, &id).and_then(|dest| std::fs::rename(&p, dest).map_err(AppError::from));
            first_error(&mut first, r, &id);
        }
    }
    first.map_or(Ok(()), Err)
}

pub fn rename_section(paths: &Paths, project: &str, from: &str, to: &str, now: DateTime<FixedOffset>) -> AppResult<()> {
    if from == to {
        return Ok(());
    }
    let mut first = None;
    for (pj, id, _) in files(paths)? {
        if pj != project {
            continue;
        }
        let r = read(paths, &pj, &id).and_then(|mut d| {
            if d.section.as_deref() == Some(from) {
                d.section = Some(to.to_string());
                d.updated = stamp(now);
                write(paths, &d)?;
            }
            Ok(())
        });
        first_error(&mut first, r, &id);
    }
    first.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "1792929845000-3f2a00000000009c";

    #[test]
    fn saved_serializes_with_a_kind() {
        let d = parse("仕事", ID, "");
        let v = serde_json::to_value(Saved::Written(d.clone())).unwrap();
        assert_eq!(v["kind"], "written");
        assert_eq!(v["id"], ID);
        let v = serde_json::to_value(Saved::Conflict { doc: d.clone(), copy: d.clone() }).unwrap();
        assert_eq!(v["kind"], "conflict");
        assert_eq!(v["doc"]["id"], ID);
        assert_eq!(v["copy"]["id"], ID);
        let v = serde_json::to_value(Saved::Recreated { copy: d }).unwrap();
        assert_eq!(v["kind"], "recreated");
        assert_eq!(v["copy"]["id"], ID);
    }

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
    fn a_file_without_front_matter_is_all_body_and_untitled() {
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

    #[test]
    fn crlf_and_bom_front_matter_is_read_and_written_once() {
        for text in [
            "---\r\ntitle: a\r\nsection: s\r\n---\r\n\r\nbody\r\n",
            "\u{feff}---\ntitle: a\nsection: s\n---\n\nbody\n",
            "\u{feff}---\r\ntitle: a\r\nsection: s\r\n---\r\n\r\nbody\r\n",
        ] {
            let d = parse("仕事", ID, text);
            assert_eq!(d.title, "a");
            assert_eq!(d.section.as_deref(), Some("s"));
            assert_eq!(d.body, "body\n");
            assert!(d.extra.is_empty());
            let out = render(&d);
            assert_eq!(out.matches("---\n").count(), 2, "{out}");
            assert_eq!(out.matches("title:").count(), 1, "{out}");
        }
    }

    #[test]
    fn unparsed_files_entries_are_kept_under_files() {
        let h = "b".repeat(64);
        let text = format!(
            "---\ntitle: a\nfiles:\n  - hash: {h}\n    ext: pdf\n  - {{\"hash\":\"{h}\",\"ext\":\"pdf\",\"name\":\"x.pdf\",\"type\":\"application/pdf\",\"size\":1}}\n  - {{broken\ncolor: blue\n---\nbody\n"
        );
        let d = parse("仕事", ID, &text);
        assert_eq!(d.files.len(), 1);
        assert_eq!(d.files[0].name, "x.pdf");
        assert_eq!(d.extra, vec!["color: blue".to_string()]);
        let out = render(&d);
        let head = &out[..out.find("\n---\n").unwrap()];
        let files_at = head.find("\nfiles:\n").expect("files key");
        for kept in [format!("  - hash: {h}\n    ext: pdf\n"), "  - {broken".to_string()] {
            let at = head.find(&kept).unwrap_or_else(|| panic!("{kept} missing in {out}"));
            assert!(at > files_at, "{kept} before files: in {out}");
        }
        assert!(head.find("color: blue").unwrap() < files_at);
        let again = parse("仕事", ID, &out);
        assert_eq!(again.files, d.files);
        assert_eq!(again.files_extra, d.files_extra);
        assert_eq!(again.extra, d.extra);
        assert_eq!(render(&again), out);
    }

    #[test]
    fn only_unparsed_files_entries_still_write_the_files_key() {
        let d = parse("仕事", ID, "---\ntitle: a\nfiles:\n  - {broken\n---\nbody\n");
        assert!(d.files.is_empty());
        assert!(render(&d).contains("\nfiles:\n  - {broken\n---\n"));
    }

    #[test]
    fn an_empty_front_matter_is_recognized() {
        for text in ["---\n---\nbody\n", "---\n---\n\nbody\n"] {
            let d = parse("仕事", ID, text);
            assert_eq!(d.title, "無題");
            assert_eq!(d.body, "body\n");
        }
        let d = parse("仕事", ID, "---\n---");
        assert_eq!(d.body, "");
        assert_eq!(render(&d).matches("---\n").count(), 2);
    }

    use chrono::{DateTime, FixedOffset, NaiveDate};

    fn at(h: u32, m: u32) -> DateTime<FixedOffset> {
        NaiveDate::from_ymd_opt(2026, 11, 28).unwrap().and_hms_opt(h, m, 0).unwrap()
            .and_local_timezone(FixedOffset::east_opt(9 * 3600).unwrap()).unwrap()
    }

    fn dir() -> (tempfile::TempDir, crate::store::paths::Paths) {
        let t = tempfile::tempdir().unwrap();
        let p = crate::store::paths::Paths::new(t.path());
        (t, p)
    }

    #[test]
    fn create_list_read_save() {
        let (_t, p) = dir();
        let a = create(&p, "仕事", None, "全体", "", "たろう", at(10, 0), 1).unwrap();
        let b = create(&p, "仕事", Some("在庫アプリ"), "在庫", "## 目的\n", "たろう", at(10, 5), 2).unwrap();
        create(&p, "私事", None, "別", "", "たろう", at(10, 6), 3).unwrap();
        let l = list(&p, "仕事").unwrap();
        assert_eq!(l.iter().map(|d| d.title.as_str()).collect::<Vec<_>>(), ["在庫", "全体"]);
        let saved = save(&p, "仕事", &a.id, &a.updated, Edit { body: Some("本文\n".into()), ..Edit::default() }, "はなこ", at(11, 0), 4).unwrap();
        let Saved::Written(d) = saved else { panic!("no conflict expected") };
        assert_eq!(d.body, "本文\n");
        assert_eq!(d.author, "はなこ");
        assert_eq!(read(&p, "仕事", &a.id).unwrap().body, "本文\n");
        assert_eq!(read(&p, "仕事", &b.id).unwrap().section.as_deref(), Some("在庫アプリ"));
    }

    #[test]
    fn saving_over_a_newer_file_keeps_both() {
        let (_t, p) = dir();
        let a = create(&p, "仕事", None, "計画", "古い\n", "たろう", at(10, 0), 1).unwrap();
        // Someone else saved after the screen read it.
        save(&p, "仕事", &a.id, &a.updated, Edit { body: Some("外の変更\n".into()), ..Edit::default() }, "はなこ", at(10, 30), 2).unwrap();
        let out = save(&p, "仕事", &a.id, &a.updated, Edit { body: Some("画面の変更\n".into()), ..Edit::default() }, "たろう", at(10, 40), 3).unwrap();
        let Saved::Conflict { doc, copy } = out else { panic!("conflict expected") };
        assert_eq!(doc.body, "外の変更\n");
        assert_eq!(copy.body, "画面の変更\n");
        assert_eq!(copy.title, "計画 (競合 2026-11-28 1040)");
        assert_ne!(copy.id, a.id);
        assert_eq!(list(&p, "仕事").unwrap().len(), 2);
    }

    #[test]
    fn project_rename_and_archive_follow() {
        let (_t, p) = dir();
        let a = create(&p, "仕事", None, "a", "", "", at(10, 0), 1).unwrap();
        rename_project(&p, "仕事", "業務").unwrap();
        assert!(list(&p, "仕事").unwrap().is_empty());
        assert_eq!(list(&p, "業務").unwrap()[0].id, a.id);
        archive(&p, "業務", None, at(12, 0).naive_local()).unwrap();
        assert!(list(&p, "業務").unwrap().is_empty());
        let archived: Vec<_> = std::fs::read_dir(p.archive_dir()).unwrap().filter_map(Result::ok).collect();
        assert_eq!(archived.len(), 1);
    }

    #[test]
    fn section_rename_rewrites_only_that_section() {
        let (_t, p) = dir();
        let a = create(&p, "仕事", Some("旧"), "a", "", "", at(10, 0), 1).unwrap();
        let b = create(&p, "仕事", Some("他"), "b", "", "", at(10, 0), 2).unwrap();
        rename_section(&p, "仕事", "旧", "新", at(11, 0)).unwrap();
        assert_eq!(read(&p, "仕事", &a.id).unwrap().section.as_deref(), Some("新"));
        assert_eq!(read(&p, "仕事", &b.id).unwrap().section.as_deref(), Some("他"));
    }

    #[test]
    fn reading_a_missing_document_is_not_found() {
        let (_t, p) = dir();
        assert!(matches!(read(&p, "仕事", ID), Err(crate::error::AppError::NotFound { .. })));
    }

    #[test]
    fn edit_tells_a_missing_section_from_null() {
        let e: Edit = serde_json::from_str(r#"{"body":"x"}"#).unwrap();
        assert_eq!(e.section, None);
        let e: Edit = serde_json::from_str(r#"{"section":null}"#).unwrap();
        assert_eq!(e.section, Some(None));
    }

    #[test]
    fn saving_a_document_archived_meanwhile_recreates_the_edit() {
        let (_t, p) = dir();
        let a = create(&p, "仕事", Some("在庫"), "計画", "古い\n", "たろう", at(10, 0), 1).unwrap();
        archive(&p, "仕事", Some(&a.id), at(10, 30).naive_local()).unwrap();
        let out = save(&p, "仕事", &a.id, &a.updated, Edit { body: Some("画面の変更\n".into()), ..Edit::default() }, "はなこ", at(10, 40), 2).unwrap();
        let Saved::Recreated { copy } = out else { panic!("recreated expected") };
        assert_eq!(copy.title, "無題 (競合 2026-11-28 1040)");
        assert_eq!(copy.body, "画面の変更\n");
        assert_eq!(copy.section, None);
        assert_eq!(copy.author, "はなこ");
        assert_ne!(copy.id, a.id);
        let l = list(&p, "仕事").unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].id, copy.id);
        assert_eq!(read(&p, "仕事", &copy.id).unwrap().body, "画面の変更\n");
        let archived: Vec<_> = std::fs::read_dir(p.archive_dir()).unwrap().filter_map(Result::ok).collect();
        assert_eq!(archived.len(), 1);
        let kept = std::fs::read_to_string(archived[0].path()).unwrap();
        assert!(kept.contains("古い\n") && !kept.contains("画面の変更"));
        let json = serde_json::to_value(Saved::Recreated { copy }).unwrap();
        assert_eq!(json["kind"], "recreated");
    }

    #[test]
    fn saving_a_titled_edit_to_a_missing_document_keeps_its_title() {
        let (_t, p) = dir();
        let out = save(
            &p,
            "仕事",
            ID,
            "2026-11-28T10:00:00+09:00",
            Edit { title: Some("計画".into()), section: Some(Some("在庫".into())), ..Edit::default() },
            "はなこ",
            at(10, 40),
            2,
        )
        .unwrap();
        let Saved::Recreated { copy } = out else { panic!("recreated expected") };
        assert_eq!(copy.title, "計画 (競合 2026-11-28 1040)");
        assert_eq!(copy.section.as_deref(), Some("在庫"));
        assert_eq!(copy.body, "");
    }

    #[test]
    fn renaming_a_section_to_itself_leaves_documents_alone() {
        let (_t, p) = dir();
        let a = create(&p, "仕事", Some("旧"), "a", "", "", at(10, 0), 1).unwrap();
        rename_section(&p, "仕事", "旧", "旧", at(11, 0)).unwrap();
        assert_eq!(read(&p, "仕事", &a.id).unwrap().updated, a.updated);
    }
}
