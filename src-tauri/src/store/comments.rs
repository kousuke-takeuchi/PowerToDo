//! Comments of a task (spec ① §3): app-only JSON Lines, one file per task at `_comments/<project>.<No>.jsonl`.
//! A line is an event (add / edit / delete); files are only appended to, and two sides merge by line id.

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::store::attachments::AttachmentInfo;
use crate::store::paths::{Paths, write_atomic};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Add,
    Edit,
    Delete,
    /// A file attached to the description (`files` holds one).
    #[serde(rename = "note-attach")]
    NoteAttach,
    /// `target` is the `note-attach` line to take off.
    #[serde(rename = "note-detach")]
    NoteDetach,
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
    /// Attachments: of an `add`, of an `edit` that replaces them (none keeps them), of a `note-attach`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<AttachmentInfo>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub at: String,
    pub author: String,
    pub text: String,
    pub edited: bool,
    pub files: Vec<AttachmentInfo>,
}

/// A file of the description: the id of its `note-attach` line is what `note-detach` names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub id: String,
    pub at: String,
    pub author: String,
    pub file: AttachmentInfo,
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
                    files: l.files.clone().unwrap_or_default(),
                });
            }
            Op::Edit => {
                if let Some(c) = l.target.as_ref().and_then(|t| by_id.get_mut(t)) {
                    if let Some(t) = &l.text {
                        c.text = t.clone();
                    }
                    if let Some(f) = &l.files {
                        c.files = f.clone();
                    }
                    c.edited = true;
                }
            }
            Op::Delete => {
                if let Some(t) = &l.target {
                    by_id.remove(t);
                }
            }
            Op::NoteAttach | Op::NoteDetach => {}
        }
    }
    by_id.into_values().collect()
}

/// The description's files in id order: `note-attach` adds the first of its `files`, `note-detach` takes
/// that line off again.
pub fn note_view(lines: &[Line]) -> Vec<NoteFile> {
    let mut sorted: Vec<&Line> = lines.iter().collect();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    let mut by_id: BTreeMap<String, NoteFile> = BTreeMap::new();
    for l in sorted {
        match l.op {
            Op::NoteAttach => {
                if let Some(file) = l.files.as_ref().and_then(|f| f.first()) {
                    by_id.entry(l.id.clone()).or_insert_with(|| NoteFile {
                        id: l.id.clone(),
                        at: l.at.clone(),
                        author: l.author.clone(),
                        file: file.clone(),
                    });
                }
            }
            Op::NoteDetach => {
                if let Some(t) = &l.target {
                    by_id.remove(t);
                }
            }
            _ => {}
        }
    }
    by_id.into_values().collect()
}

/// Both sides' lines, one per id, in id order (with a trailing newline). Two different lines with one id keep
/// the smaller text, so the result does not depend on which side is which. A line is kept as written
/// whenever it is a JSON object with a string `id`, even when this version cannot read it (an `op` of
/// a later version): the merged copy goes to both sides, so dropping it would lose it for good.
pub fn merge(a: &str, b: &str) -> String {
    let mut by_id: BTreeMap<String, String> = BTreeMap::new();
    for raw in a.lines().chain(b.lines()) {
        let Ok(serde_json::Value::Object(obj)) = serde_json::from_str::<serde_json::Value>(raw)
        else {
            continue;
        };
        let Some(id) = obj.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        by_id
            .entry(id.to_string())
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

// ---- files (spec ① §3.1, §3.5) ----

/// The file of one task. The project must be a valid project name (no path in it).
fn path(paths: &Paths, project: &str, no: u32) -> AppResult<PathBuf> {
    crate::store::paths::validate_project_name(project)?;
    Ok(paths.comments_dir().join(file_name(project, no)))
}

/// The file's text; a missing file is empty.
fn read_text(path: &Path) -> AppResult<String> {
    match std::fs::read_to_string(path) {
        Ok(t) => Ok(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

/// The comments of one task (a missing file has none).
pub fn read(paths: &Paths, project: &str, no: u32) -> AppResult<Vec<Comment>> {
    Ok(view(&parse(&read_text(&path(paths, project, no)?)?)))
}

/// The description's files of one task (a missing file has none).
pub fn read_notes(paths: &Paths, project: &str, no: u32) -> AppResult<Vec<NoteFile>> {
    Ok(note_view(&parse(&read_text(&path(paths, project, no)?)?)))
}

/// Appends one line (creates `_comments/` and the file when needed) and flushes it to disk.
pub fn append(paths: &Paths, project: &str, no: u32, line: &Line) -> AppResult<()> {
    let file = path(paths, project, no)?;
    std::fs::create_dir_all(paths.comments_dir())?;
    // A last line cut short (a crash mid-write, a hand edit) must not swallow this one.
    let broken_end = std::fs::read(&file).is_ok_and(|b| b.last().is_some_and(|&c| c != b'\n'));
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)?;
    if broken_end {
        f.write_all(b"\n")?;
    }
    f.write_all(to_line(line).as_bytes())?;
    f.sync_all()?;
    Ok(())
}

/// The comment files of `_comments/` as (project, No., path).
fn files(paths: &Paths) -> AppResult<Vec<(String, u32, PathBuf)>> {
    let entries = match std::fs::read_dir(paths.comments_dir()) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let Ok(name) = e.file_name().into_string() else {
            continue;
        };
        if let Some((project, no)) = parse_file_name(&name) {
            out.push((project, no, e.path()));
        }
    }
    Ok(out)
}

/// Visible comments per task No. of `project` (tasks without comments are left out).
pub fn counts(paths: &Paths, project: &str) -> AppResult<BTreeMap<u32, u32>> {
    let mut out = BTreeMap::new();
    for (pj, no, p) in files(paths)? {
        if pj != project {
            continue;
        }
        let n = view(&parse(&read_text(&p)?)).len() as u32;
        if n > 0 {
            out.insert(no, n);
        }
    }
    Ok(out)
}

/// Attachments per task No. of `project`: the files of visible comments plus the description's (tasks
/// without any are left out).
pub fn attachment_counts(paths: &Paths, project: &str) -> AppResult<BTreeMap<u32, u32>> {
    let mut out = BTreeMap::new();
    for (pj, no, p) in files(paths)? {
        if pj != project {
            continue;
        }
        let lines = parse(&read_text(&p)?);
        let n: usize =
            view(&lines).iter().map(|c| c.files.len()).sum::<usize>() + note_view(&lines).len();
        if n > 0 {
            out.insert(no, n as u32);
        }
    }
    Ok(out)
}

/// A renamed project: its comment files take the new name.
pub fn rename_project(paths: &Paths, from: &str, to: &str) -> AppResult<()> {
    for (pj, no, p) in files(paths)? {
        if pj == from {
            move_file(paths, &p, &path(paths, to, no)?)?;
        }
    }
    Ok(())
}

/// Moves one task's comments (`Some(no)`) or a whole project's into `archive/` as `<stem> (<YYYYMMDD-HHMM>).jsonl`.
pub fn archive(paths: &Paths, project: &str, no: Option<u32>, now: NaiveDateTime) -> AppResult<()> {
    let tag = now.format("%Y%m%d-%H%M").to_string();
    for (pj, n, p) in files(paths)? {
        if pj != project || no.is_some_and(|x| x != n) {
            continue;
        }
        let dir = paths.archive_dir();
        std::fs::create_dir_all(&dir)?;
        let stem = format!("{pj}.{n}");
        let mut k = 1;
        let dest = loop {
            let name = if k == 1 {
                format!("{stem} ({tag}).jsonl")
            } else {
                format!("{stem} ({tag}-{k}).jsonl")
            };
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

/// A task that got another project or No.: its comments follow, merged into the target's when that exists.
pub fn move_task(paths: &Paths, from: (&str, u32), to: (&str, u32)) -> AppResult<()> {
    let src = path(paths, from.0, from.1)?;
    if !src.exists() {
        return Ok(());
    }
    move_file(paths, &src, &path(paths, to.0, to.1)?)
}

/// Moves `src` to `dest`; when `dest` exists, `dest` gets the merged lines of both.
fn move_file(paths: &Paths, src: &Path, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(paths.comments_dir())?;
    if dest.exists() {
        let merged = merge(&read_text(dest)?, &read_text(src)?);
        write_atomic(dest, merged.as_bytes())?;
        std::fs::remove_file(src)?;
    } else {
        std::fs::rename(src, dest)?;
    }
    Ok(())
}

/// Only the author edits or deletes a comment (spec ① §3.3); a missing comment cannot be changed.
pub fn check_author(lines: &[Line], id: &str, author: &str) -> AppResult<()> {
    match view(lines).into_iter().find(|c| c.id == id) {
        Some(c) if c.author == author => Ok(()),
        Some(_) => Err(AppError::Invalid {
            message: "自分のコメントだけ変えられます".into(),
        }),
        None => Err(AppError::NotFound {
            message: "コメントが見つかりません".into(),
        }),
    }
}

/// The lines of one task's file (a missing file has none).
pub fn lines(paths: &Paths, project: &str, no: u32) -> AppResult<Vec<Line>> {
    Ok(parse(&read_text(&path(paths, project, no)?)?))
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
            files: None,
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
            files: None,
        };
        let d = Line {
            id: "0004".into(),
            op: Op::Delete,
            target: Some("0002".into()),
            at: "t".into(),
            author: "たろう".into(),
            text: None,
            files: None,
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

    // ---- files ----

    fn paths() -> (tempfile::TempDir, Paths) {
        let tmp = tempfile::tempdir().unwrap();
        let p = Paths::new(tmp.path());
        (tmp, p)
    }

    fn at() -> NaiveDateTime {
        NaiveDateTime::parse_from_str("2026-10-25T21:04:00", "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    #[test]
    fn append_then_read() {
        let (_t, p) = paths();
        append(&p, "仕事", 12, &add("0001", "a")).unwrap();
        append(&p, "仕事", 12, &add("0002", "b")).unwrap();
        let got: Vec<String> = read(&p, "仕事", 12)
            .unwrap()
            .into_iter()
            .map(|c| c.text)
            .collect();
        assert_eq!(got, ["a", "b"]);
    }

    #[test]
    fn read_missing_is_empty() {
        let (_t, p) = paths();
        assert!(read(&p, "仕事", 1).unwrap().is_empty());
    }

    #[test]
    fn counts_skip_deleted() {
        let (_t, p) = paths();
        append(&p, "仕事", 12, &add("0001", "a")).unwrap();
        append(&p, "仕事", 12, &add("0002", "b")).unwrap();
        let del = Line {
            id: "0003".into(),
            op: Op::Delete,
            target: Some("0001".into()),
            at: "t".into(),
            author: "たろう".into(),
            text: None,
            files: None,
        };
        append(&p, "仕事", 12, &del).unwrap();
        append(&p, "仕事2", 1, &add("0004", "c")).unwrap();
        assert_eq!(counts(&p, "仕事").unwrap(), BTreeMap::from([(12, 1)]));
    }

    #[test]
    fn rename_project_moves_its_files_only() {
        let (_t, p) = paths();
        for (pj, no) in [("仕事", 1), ("仕事", 2), ("仕事2", 1)] {
            append(&p, pj, no, &add("0001", "a")).unwrap();
        }
        rename_project(&p, "仕事", "業務").unwrap();
        let d = p.comments_dir();
        assert!(d.join("業務.1.jsonl").exists() && d.join("業務.2.jsonl").exists());
        assert!(!d.join("仕事.1.jsonl").exists());
        assert!(d.join("仕事2.1.jsonl").exists());
    }

    #[test]
    fn archive_one_task_and_a_project() {
        let (_t, p) = paths();
        for no in [1, 2] {
            append(&p, "仕事", no, &add("0001", "a")).unwrap();
        }
        archive(&p, "仕事", Some(1), at()).unwrap();
        assert!(!p.comments_dir().join("仕事.1.jsonl").exists());
        assert!(
            p.archive_dir()
                .join("仕事.1 (20261025-2104).jsonl")
                .exists()
        );
        archive(&p, "仕事", None, at()).unwrap();
        assert!(!p.comments_dir().join("仕事.2.jsonl").exists());
        assert!(
            p.archive_dir()
                .join("仕事.2 (20261025-2104).jsonl")
                .exists()
        );
    }

    #[test]
    fn move_task_merges_into_an_existing_target() {
        let (_t, p) = paths();
        append(&p, "仕事", 1, &add("0001", "a")).unwrap();
        append(&p, "買い物", 5, &add("0002", "b")).unwrap();
        move_task(&p, ("仕事", 1), ("買い物", 5)).unwrap();
        assert!(!p.comments_dir().join("仕事.1.jsonl").exists());
        assert_eq!(read(&p, "買い物", 5).unwrap().len(), 2);
        move_task(&p, ("仕事", 9), ("買い物", 6)).unwrap();
        assert!(
            !p.comments_dir().join("買い物.6.jsonl").exists(),
            "nothing to move"
        );
    }

    #[test]
    fn only_the_author_changes_a_comment() {
        let lines = vec![add("0001", "a")];
        assert!(check_author(&lines, "0001", "たろう").is_ok());
        assert!(check_author(&lines, "0001", "はなこ").is_err());
        assert!(
            check_author(&lines, "9999", "たろう").is_err(),
            "a missing comment"
        );
    }

    #[test]
    fn append_after_a_broken_last_line_starts_a_new_line() {
        let (_t, p) = paths();
        std::fs::create_dir_all(p.comments_dir()).unwrap();
        std::fs::write(
            p.comments_dir().join("仕事.1.jsonl"),
            "{\"id\":\"0000\",\"op\":\"add\"",
        )
        .unwrap();
        append(&p, "仕事", 1, &add("0001", "a")).unwrap();
        assert_eq!(
            read(&p, "仕事", 1).unwrap().len(),
            1,
            "the new comment reads"
        );
    }

    #[test]
    fn a_project_name_with_a_path_is_refused() {
        let (_t, p) = paths();
        assert!(append(&p, "../x", 1, &add("0001", "a")).is_err());
        assert!(read(&p, "../x", 1).is_err());
    }

    // ---- attachments (spec attachments §3) ----

    fn info(n: u8) -> AttachmentInfo {
        AttachmentInfo {
            hash: format!("{n:064x}"),
            ext: "png".into(),
            name: format!("{n}.png"),
            mime: "image/png".into(),
            size: 10,
            w: Some(4),
            h: Some(3),
        }
    }

    fn with_files(mut l: Line, files: Vec<AttachmentInfo>) -> Line {
        l.files = Some(files);
        l
    }

    fn edit(
        id: &str,
        target: &str,
        text: Option<&str>,
        files: Option<Vec<AttachmentInfo>>,
    ) -> Line {
        Line {
            id: id.into(),
            op: Op::Edit,
            target: Some(target.into()),
            at: "t".into(),
            author: "たろう".into(),
            text: text.map(Into::into),
            files,
        }
    }

    fn note(id: &str, op: Op, target: Option<&str>, files: Option<Vec<AttachmentInfo>>) -> Line {
        Line {
            id: id.into(),
            op,
            target: target.map(Into::into),
            at: "t".into(),
            author: "たろう".into(),
            text: None,
            files,
        }
    }

    #[test]
    fn an_add_carries_its_files_and_may_have_no_text() {
        let v = view(&[with_files(add("0001", ""), vec![info(1), info(2)])]);
        assert_eq!(v[0].files, [info(1), info(2)]);
        assert_eq!(v[0].text, "");
    }

    #[test]
    fn an_edit_without_files_keeps_them_and_one_with_files_replaces_them() {
        let a = with_files(add("0001", "a"), vec![info(1)]);
        let v = view(&[a.clone(), edit("0002", "0001", Some("b"), None)]);
        assert_eq!(
            (v[0].text.as_str(), v[0].files.clone()),
            ("b", vec![info(1)])
        );
        let v = view(&[
            a.clone(),
            edit("0002", "0001", Some("b"), Some(vec![info(2), info(3)])),
        ]);
        assert_eq!(v[0].files, [info(2), info(3)]);
        let v = view(&[a, edit("0002", "0001", Some("b"), Some(vec![]))]);
        assert!(v[0].files.is_empty(), "an empty array takes them all off");
    }

    #[test]
    fn note_files_attach_and_detach_in_id_order() {
        let lines = vec![
            note("0003", Op::NoteDetach, Some("0001"), None),
            note("0002", Op::NoteAttach, None, Some(vec![info(2)])),
            note("0001", Op::NoteAttach, None, Some(vec![info(1)])),
            note("0004", Op::NoteAttach, None, Some(vec![info(4)])),
            note("0005", Op::NoteDetach, Some("9999"), None),
        ];
        let ids: Vec<String> = note_view(&lines).into_iter().map(|n| n.id).collect();
        assert_eq!(ids, ["0002", "0004"]);
        assert!(view(&lines).is_empty(), "they are not comments");
    }

    #[test]
    fn old_lines_without_files_mix_with_new_ones() {
        let old = r#"{"id":"0001","op":"add","at":"t","author":"たろう","text":"古い"}"#;
        let new = to_line(&with_files(add("0002", "新しい"), vec![info(1)]));
        let lines = parse(&format!("{old}\n{new}"));
        let v = view(&lines);
        assert_eq!(v.len(), 2);
        assert!(v[0].files.is_empty());
        assert_eq!(v[1].files.len(), 1);
        assert!(
            !to_line(&add("0003", "x")).contains("files"),
            "none is not written"
        );
    }

    #[test]
    fn an_unknown_op_is_skipped_and_the_rest_reads() {
        let text = format!(
            "{}{{\"id\":\"0002\",\"op\":\"pin\",\"at\":\"t\",\"author\":\"x\"}}\n{}",
            to_line(&add("0001", "a")),
            to_line(&add("0003", "b"))
        );
        assert_eq!(parse(&text).len(), 2);
    }

    #[test]
    fn merge_keeps_lines_of_an_unknown_op_and_unknown_fields_as_written() {
        let future = r#"{"id":"0002","op":"pin","at":"t","author":"x","extra":[1]}"#;
        let a = format!("{}{future}\n", to_line(&add("0001", "a")));
        let b = to_line(&add("0003", "b"));
        let m = merge(&a, &b);
        assert!(m.contains(&format!("{future}\n")), "{m}");
        assert_eq!(m.lines().count(), 3);
        assert_eq!(parse(&m).len(), 2, "this version still skips it when reading");
        assert!(!merge("not json\n[1]\n{\"op\":\"add\"}\n", "").contains('{'));
    }

    #[test]
    fn the_new_ops_use_their_kebab_names() {
        let l = to_line(&note("0001", Op::NoteAttach, None, Some(vec![info(1)])));
        assert!(l.contains(r#""op":"note-attach""#), "{l}");
        assert_eq!(parse(&l).len(), 1);
    }

    #[test]
    fn attachment_counts_cover_comments_and_the_description() {
        let (_t, p) = paths();
        append(
            &p,
            "仕事",
            1,
            &with_files(add("0001", "a"), vec![info(1), info(2)]),
        )
        .unwrap();
        append(
            &p,
            "仕事",
            1,
            &note("0002", Op::NoteAttach, None, Some(vec![info(3)])),
        )
        .unwrap();
        append(&p, "仕事", 2, &add("0003", "plain")).unwrap();
        append(
            &p,
            "仕事",
            3,
            &with_files(add("0004", "gone"), vec![info(4)]),
        )
        .unwrap();
        append(&p, "仕事", 3, &note("0005", Op::Delete, Some("0004"), None)).unwrap();
        append(&p, "別", 1, &with_files(add("0006", "x"), vec![info(5)])).unwrap();
        assert_eq!(
            attachment_counts(&p, "仕事").unwrap(),
            BTreeMap::from([(1, 3)])
        );
        assert_eq!(read_notes(&p, "仕事", 1).unwrap().len(), 1);
    }

    #[test]
    fn a_file_with_attachments_moves_and_archives_like_any_other() {
        let (_t, p) = paths();
        append(&p, "仕事", 1, &with_files(add("0001", "a"), vec![info(1)])).unwrap();
        move_task(&p, ("仕事", 1), ("仕事", 7)).unwrap();
        assert_eq!(read(&p, "仕事", 7).unwrap()[0].files.len(), 1);
        rename_project(&p, "仕事", "業務").unwrap();
        assert_eq!(read(&p, "業務", 7).unwrap()[0].files.len(), 1);
        archive(&p, "業務", Some(7), at()).unwrap();
        assert!(read(&p, "業務", 7).unwrap().is_empty());
    }
}
