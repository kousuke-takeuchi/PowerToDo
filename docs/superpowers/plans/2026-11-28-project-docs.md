# Project documents (sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects and sections get any number of documents (WYSIWYG, saved as Markdown in `_docs/`) with reference files, on desktop and iPhone, synced over NAS and Google Drive.

**Architecture:** Rust owns the file format (`store/docs.rs`: front matter + Markdown body, one file per document at `_docs/<project>.<id>.md`) and exposes commands; the sync engine gets a `_docs` pass modelled on the `_comments` pass, but a two-sided change keeps both (the older side becomes a conflict copy). The screen edits with TipTap 3 and its Markdown extension; Markdown <-> editor JSON and the image path mapping are pure `.ts` tested with `node --test`.

**Tech Stack:** Rust (Tauri 2), React 19 + TypeScript, TipTap 3.34.0 (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/extension-list`, `@tiptap/extension-table`, `@tiptap/extension-image`), node `--test`.

**Spec:** `docs/superpowers/specs/2026-11-28-project-docs-design.md` (section 1, 「データ」, 「古い版の端末」). Sections 2 (calendar tab) and 3 (gantt tab) are NOT in this plan.

## Global Constraints

- Data folder files are the source of truth; no database. Documents live at `_docs/<プロジェクト名>.<id>.md`, one flat folder.
- `id` = 13-digit epoch milliseconds + `-` + 16 lower-case hex digits (same as `store::comments::new_id`).
- Front matter keys: `title`, `section` (empty or missing = whole project), `created`, `updated`, `author`, `files`. Unknown keys are kept on write.
- Reference files and body images are blobs in `_attachments/` (existing `add_attachment`, 50 MB limit). Body images are referenced as `../_attachments/<hash>.<ext>`.
- Never delete files: deleting a document or a project moves its documents to `archive/`.
- A two-sided change (sync, or an external edit while the screen holds an older version) keeps both: the newer `updated` keeps the name; the other gets a new id and the title `<題名> (競合 yyyy-mm-dd hhmm)`.
- Old app versions do not know `_docs/`: they must neither sync nor touch it (no change to their code paths).
- User-visible text is Japanese; identifiers, comments and commit messages are English Conventional Commits. No `Co-Authored-By` or other AI trailer in commits.
- Pin TipTap packages to exactly `3.34.0` (released 2026-11-13; newer ones are under two weeks old).
- Pure screen logic goes in `.ts` without React/DOM and is tested with `node --test` (`npm run test:web`).
- Every behaviour change updates docs in the same commit (`docs/internal/data-model.md`, `docs/03-desktop.md`, `docs/04-iphone.md`, `design/storyboard.md`).
- Example names in tests and docs are invented (e.g. 在庫アプリ, 仕事); no real user data.

## Review Focus

1. A project name containing dots (`v1.2 リリース`) must still map `_docs/<project>.<id>.md` back to the right project: parse takes the id from the end. Test in Task 1.
2. A title containing `:`, `"`, `#` or a leading space must survive a write and read unchanged: values are written as JSON strings. Test in Task 1.
3. Typing then closing the document (or switching to another one, or leaving the screen) within the 1 s autosave delay must still save: the autosave flushes on leave. Test in Task 6 (`autosave.ts`).
4. A body image whose blob has not arrived yet (sync pending) must show its alt text, not break the editor, and must be written back with its original relative path. Test in Task 5.
5. The file changed on disk (another editor, or a sync download) while the screen still holds the older version: saving must not overwrite it; it creates a conflict copy and says so. Test in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/store/docs.rs` (new) | File names, ids, front matter parse/render, list/read/create/save/archive, project rename/archive, section rename, conflict copy |
| `src-tauri/src/store/mod.rs` | `pub mod docs;` |
| `src-tauri/src/store/paths.rs` | `Paths::docs_dir()` |
| `src-tauri/src/store/project_store.rs` | rename project / delete project / rename section call `docs::*` |
| `src-tauri/src/commands/docs.rs` (new) | Tauri commands and the `docs-changed` event |
| `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` | register commands; watcher batch routes `_docs/` paths to `docs-changed` |
| `src-tauri/src/store/watcher.rs` | also watch `_docs/` |
| `src-tauri/src/sync/backend.rs`, `webdav.rs`, `gdrive.rs` | `list_docs`, `upload_doc`, `archive_doc` |
| `src-tauri/src/sync/mod.rs` | `DOC_KEY_PREFIX`, `is_doc_key` |
| `src-tauri/src/sync/engine.rs` | `_docs` pass, listing, fingerprint, `docs_changed` host hook |
| `src/api/client.ts`, `src/api/events.ts` | typed commands and event |
| `src/app/docMarkdown.ts` (+test) | TipTap extension list, Markdown <-> JSON, image path mapping, template |
| `src/app/autosave.ts` (+test) | debounce with flush |
| `src/app/useDocs.ts` | list/read/save/create/delete with the event |
| `src/components/DocEditor.tsx` | TipTap editor + toolbar |
| `src/components/ReferenceFiles.tsx` | 参考資料 box |
| `src/views/DocsPane.tsx` (+stories) | desktop list + document |
| `src/views/mobile/MobileDocs.tsx` (+stories) | iPhone list screen and document screen |
| `src/views/ProjectView.tsx`, `src/app/Main.tsx` | desktop リスト / ドキュメント switch, section button |
| `src/app/mobileNav.ts` (+test), `src/app/MobileMain.tsx` | iPhone `docs` / `doc` screens, menu rows |

---

### Task 1: Document file format in Rust (`store/docs.rs`)

**Files:**
- Create: `src-tauri/src/store/docs.rs`
- Modify: `src-tauri/src/store/mod.rs`, `src-tauri/src/store/paths.rs` (add `docs_dir` next to `comments_dir`)

**Interfaces:**
- Produces (used by Tasks 2, 3, 4):
  - `pub const DIR: &str = "_docs";`
  - `pub fn file_name(project: &str, id: &str) -> String`
  - `pub fn parse_file_name(name: &str) -> Option<(String, String)>` (project, id)
  - `pub struct Doc { id, project, title, section: Option<String>, created, updated, author, files: Vec<AttachmentInfo>, body: String, extra: Vec<String> }` (serde camelCase; `extra` skipped in serialization)
  - `pub fn parse(project: &str, id: &str, text: &str) -> Doc`
  - `pub fn render(doc: &Doc) -> String`
  - `pub fn new_id(now_ms: u64) -> String` (re-exports `comments::new_id`)

- [ ] **Step 1: Add the folder to `Paths`**

In `src-tauri/src/store/paths.rs`, after `comments_dir`:

```rust
    /// `_docs/`: one Markdown file per project document (spec project docs).
    pub fn docs_dir(&self) -> PathBuf {
        self.data_dir.join(crate::store::docs::DIR)
    }
```

In `src-tauri/src/store/mod.rs` add `pub mod docs;`.

- [ ] **Step 2: Write the failing tests** (bottom of the new `docs.rs`)

```rust
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
```

- [ ] **Step 3: Run to see them fail**

Run: `cd src-tauri && cargo test --lib store::docs`
Expected: compile errors (functions not defined).

- [ ] **Step 4: Implement**

```rust
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
    if raw.starts_with('"') {
        if let Ok(s) = serde_json::from_str::<String>(raw) {
            return s;
        }
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
```

Note: `AttachmentInfo` already derives `Deserialize` (`store/attachments.rs`). The test `front_matter_round_trips_and_keeps_unknown_keys` reads `section: 在庫アプリ` unquoted: `value` returns it as text.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib store::docs`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/store/docs.rs src-tauri/src/store/mod.rs src-tauri/src/store/paths.rs
git commit -m "feat(store): project document file format in _docs"
```

---

### Task 2: Document files on disk and following project/section changes

**Files:**
- Modify: `src-tauri/src/store/docs.rs`, `src-tauri/src/store/project_store.rs` (`rename_project` ~l.708, `delete_project` ~l.862 and ~l.1007, `rename_section` ~l.1025)
- Test: `src-tauri/src/store/docs.rs` tests, `src-tauri/src/store/project_store.rs` tests next to `rename_project_renames_comment_files` (~l.4304)

**Interfaces:**
- Consumes: Task 1.
- Produces (used by Tasks 3, 4):
  - `pub struct DocSummary { id, project, title, section: Option<String>, updated, author, files: usize }` (serde camelCase)
  - `pub fn list(paths: &Paths, project: &str) -> AppResult<Vec<DocSummary>>` (newest `updated` first)
  - `pub fn read(paths: &Paths, project: &str, id: &str) -> AppResult<Doc>` (`NotFound` when missing)
  - `pub struct Edit { title: Option<String>, section: Option<Option<String>>, body: Option<String>, files: Option<Vec<AttachmentInfo>> }` (serde camelCase, `Deserialize`)
  - `pub fn create(paths, project, section: Option<&str>, title: &str, body: &str, author: &str, now: DateTime<FixedOffset>, now_ms: u64) -> AppResult<Doc>`
  - `pub enum Saved { Written(Doc), Conflict { doc: Doc, copy: Doc } }` (serde tag `kind`, camelCase)
  - `pub fn save(paths, project, id, base_updated: &str, edit: Edit, author: &str, now: DateTime<FixedOffset>, now_ms: u64) -> AppResult<Saved>`
  - `pub fn conflict_copy(paths, project, loser: &Doc, now: DateTime<FixedOffset>, now_ms: u64) -> AppResult<Doc>`
  - `pub fn archive(paths, project, id: Option<&str>, now: NaiveDateTime) -> AppResult<()>`
  - `pub fn rename_project(paths, from, to) -> AppResult<()>`
  - `pub fn rename_section(paths, project, from, to, now: DateTime<FixedOffset>) -> AppResult<()>`

- [ ] **Step 1: Write the failing tests** (append to `docs.rs` tests)

```rust
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
```

- [ ] **Step 2: Run to see them fail**

Run: `cd src-tauri && cargo test --lib store::docs`
Expected: compile errors for `create`, `list`, `save`, ….

- [ ] **Step 3: Implement** (add to `docs.rs`)

```rust
use std::path::PathBuf;

use chrono::{DateTime, FixedOffset, NaiveDateTime};
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::store::paths::{Paths, validate_project_name, write_atomic};

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
pub enum Saved {
    Written(Doc),
    Conflict { doc: Doc, copy: Doc },
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
    let current = read(paths, project, id)?;
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

pub fn rename_project(paths: &Paths, from: &str, to: &str) -> AppResult<()> {
    for (pj, id, p) in files(paths)? {
        if pj == from {
            std::fs::rename(&p, path(paths, to, &id)?)?;
        }
    }
    Ok(())
}

pub fn rename_section(paths: &Paths, project: &str, from: &str, to: &str, now: DateTime<FixedOffset>) -> AppResult<()> {
    for (pj, id, _) in files(paths)? {
        if pj != project {
            continue;
        }
        let mut d = read(paths, &pj, &id)?;
        if d.section.as_deref() == Some(from) {
            d.section = Some(to.to_string());
            d.updated = stamp(now);
            write(paths, &d)?;
        }
    }
    Ok(())
}
```

`Edit.section` tells a missing key from `null` (no new crate). Add a test:

```rust
    #[test]
    fn edit_tells_a_missing_section_from_null() {
        let e: Edit = serde_json::from_str(r#"{"body":"x"}"#).unwrap();
        assert_eq!(e.section, None);
        let e: Edit = serde_json::from_str(r#"{"section":null}"#).unwrap();
        assert_eq!(e.section, Some(None));
    }
```

- [ ] **Step 4: Run the docs tests**

Run: `cd src-tauri && cargo test --lib store::docs`
Expected: all pass.

- [ ] **Step 5: Follow project and section changes in the store — failing tests**

Next to `rename_project_renames_comment_files` in `project_store.rs` tests, add (use the same test helpers that test uses: look at it and copy its setup lines exactly for creating the store `e`, the project, and `Paths::new(e.data())`):

```rust
    #[test]
    fn rename_and_delete_project_carry_its_documents() {
        // setup: same as rename_project_renames_comment_files (store with project 仕事)
        let paths = Paths::new(e.data());
        let at = chrono::DateTime::parse_from_rfc3339("2026-11-28T10:00:00+09:00").unwrap();
        crate::store::docs::create(&paths, "仕事", None, "a", "", "", at, 1).unwrap();
        store.rename_project("仕事", "業務").unwrap();
        assert_eq!(crate::store::docs::list(&paths, "業務").unwrap().len(), 1);
        store.delete_project("業務").unwrap();
        assert!(crate::store::docs::list(&paths, "業務").unwrap().is_empty());
    }

    #[test]
    fn rename_section_carries_its_documents() {
        // setup: a store with project 仕事 and section 旧 (see sections_add_rename_reorder)
        let paths = Paths::new(e.data());
        let at = chrono::DateTime::parse_from_rfc3339("2026-11-28T10:00:00+09:00").unwrap();
        let d = crate::store::docs::create(&paths, "仕事", Some("旧"), "a", "", "", at, 1).unwrap();
        store.rename_section("仕事", "旧", "新").unwrap();
        assert_eq!(crate::store::docs::read(&paths, "仕事", &d.id).unwrap().section.as_deref(), Some("新"));
    }
```

Run: `cd src-tauri && cargo test --lib project_store::tests::rename_and_delete_project_carry_its_documents project_store::tests::rename_section_carries_its_documents`
Expected: FAIL (documents stay under the old names).

- [ ] **Step 6: Hook the store**

In `project_store.rs`:
- `rename_project`, right after `comments_follow(comments::rename_project(&self.paths, name, new_name));`:
  ```rust
  comments_follow(crate::store::docs::rename_project(&self.paths, name, new_name));
  ```
- Both places with `comments_follow(comments::archive(&self.paths, <name>, None, self.now()));` (in `delete_project` and in the archive-of-a-failed-file path ~l.1007): add the same call with `crate::store::docs::archive(&self.paths, <name>, None, self.now())`.
- `rename_section`, after the `self.mutate(...)?;` succeeds and before `self.view(project)`:
  ```rust
  let now = chrono::Local::now().fixed_offset();
  comments_follow(crate::store::docs::rename_section(&self.paths, project, name, &new_name, now));
  ```

There is no "delete section" operation in the store today, so the spec's 「セクションを消す」 row has nothing to hook; a document whose section no longer exists keeps its section name and is still listed (Task 7 shows it).

- [ ] **Step 7: Run the store tests**

Run: `cd src-tauri && cargo test --lib store::`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/store/docs.rs src-tauri/src/store/project_store.rs
git commit -m "feat(store): read, save and archive documents; follow project and section renames"
```

---

### Task 3: Commands, watcher and the `docs-changed` event

**Files:**
- Create: `src-tauri/src/commands/docs.rs`
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod docs;`, `handle_fs_batch`), the `invoke_handler` list (find it with `grep -n "list_comments" src-tauri/src/lib.rs`), `src-tauri/src/store/watcher.rs`, `src-tauri/src/sync/engine.rs` (`SyncHost::docs_changed`)

**Interfaces:**
- Consumes: Task 2.
- Produces (used by Task 6): commands
  - `list_docs(project: String) -> Vec<DocSummary>`
  - `read_doc(project: String, id: String) -> Doc`
  - `create_doc(project: String, section: Option<String>, title: String, body: String) -> Doc`
  - `save_doc(project: String, id: String, base_updated: String, edit: Edit) -> Saved`
  - `delete_doc(project: String, id: String) -> ()`
  - event `docs-changed` with payload `{ files: string[] }` (leaf names `<project>.<id>.md`)

- [ ] **Step 1: Failing test for the watcher batch split**

In `commands/docs.rs`:

```rust
/// The `_docs/` leaves among the watcher's paths (the rest go to the workbook handling).
pub fn doc_leaves(data_dir: &std::path::Path, paths: &[std::path::PathBuf]) -> Vec<String> {
    let dir = data_dir.join(crate::store::docs::DIR);
    let mut out: Vec<String> = paths
        .iter()
        .filter(|p| p.parent() == Some(dir.as_path()))
        .filter_map(|p| p.file_name()?.to_str().map(str::to_string))
        .filter(|n| crate::store::docs::parse_file_name(n).is_some())
        .collect();
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn only_document_files_are_doc_leaves() {
        let d = PathBuf::from("/data");
        let id = "1792929845000-3f2a00000000009c";
        let paths = vec![
            d.join("仕事.xlsx"),
            d.join("_docs").join(format!("仕事.{id}.md")),
            d.join("_docs").join(format!("仕事.{id}.md")),
            d.join("_docs").join("note.txt"),
        ];
        assert_eq!(doc_leaves(&d, &paths), vec![format!("仕事.{id}.md")]);
    }
}
```

Run: `cd src-tauri && cargo test --lib commands::docs` (after adding `pub mod docs;` to `commands/mod.rs`)
Expected: PASS once the file compiles (this pins behaviour used in Step 3).

- [ ] **Step 2: Commands**

Above the tests in `commands/docs.rs` (follow `commands/comments.rs` for `with_store`, the author name and the time; read how `add_comment` gets the author's display name and copy that exact expression into `author_of`):

```rust
//! Project documents (spec project docs): list, read, create, save, delete, and `docs-changed`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::{AppState, with_store};
use crate::error::AppResult;
use crate::store::docs::{self, Doc, DocSummary, Edit, Saved};

#[derive(Debug, Clone, Serialize)]
pub struct DocsChanged {
    pub files: Vec<String>,
}

pub fn emit_docs_changed(app: &AppHandle, files: Vec<String>) {
    let _ = app.emit("docs-changed", DocsChanged { files });
}

fn now() -> (chrono::DateTime<chrono::FixedOffset>, u64) {
    let n = chrono::Local::now();
    (n.fixed_offset(), n.timestamp_millis() as u64)
}

#[tauri::command]
pub async fn list_docs(project: String, state: State<'_, AppState>) -> AppResult<Vec<DocSummary>> {
    with_store(state.inner(), |s| docs::list(s.paths(), &project))
}

#[tauri::command]
pub async fn read_doc(project: String, id: String, state: State<'_, AppState>) -> AppResult<Doc> {
    with_store(state.inner(), |s| docs::read(s.paths(), &project, &id))
}

#[tauri::command]
pub async fn create_doc(
    project: String,
    section: Option<String>,
    title: String,
    body: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Doc> {
    let (at, ms) = now();
    let d = with_store(state.inner(), |s| {
        docs::create(s.paths(), &project, section.as_deref(), &title, &body, &author_of(s), at, ms)
    })?;
    emit_docs_changed(&app, vec![docs::file_name(&d.project, &d.id)]);
    Ok(d)
}

#[tauri::command]
pub async fn save_doc(
    project: String,
    id: String,
    base_updated: String,
    edit: Edit,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Saved> {
    let (at, ms) = now();
    let out = with_store(state.inner(), |s| {
        docs::save(s.paths(), &project, &id, &base_updated, edit, &author_of(s), at, ms)
    })?;
    let mut files = vec![docs::file_name(&project, &id)];
    if let Saved::Conflict { copy, .. } = &out {
        files.push(docs::file_name(&project, &copy.id));
    }
    emit_docs_changed(&app, files);
    Ok(out)
}

#[tauri::command]
pub async fn delete_doc(project: String, id: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    with_store(state.inner(), |s| docs::archive(s.paths(), &project, Some(&id), chrono::Local::now().naive_local()))?;
    emit_docs_changed(&app, vec![docs::file_name(&project, &id)]);
    Ok(())
}
```

Write `fn author_of(s: &crate::store::project_store::ProjectStore) -> String` using the same source of the display name that `commands/comments.rs` uses for `author` (read it; do not invent a new one).

Register the five commands in the `invoke_handler` list next to `list_comments`.

After saving through the commands, schedule a sync the same way `add_comment` does after writing (read `add_comment` and copy its scheduling call if it has one; if comments rely on the 30 s check, do nothing extra).

- [ ] **Step 3: Watch `_docs/` and route it**

In `store/watcher.rs` `start`, after the existing `watch(dir, NonRecursive)`:

```rust
    let docs = dir.join(crate::store::docs::DIR);
    if std::fs::create_dir_all(&docs).is_ok() {
        inner.watch(&docs, RecursiveMode::NonRecursive).map_err(watch_error)?;
    }
```

In `commands/mod.rs` `handle_fs_batch`, at the top after `let state = ...`:

```rust
    let data_dir = state.lock_store().as_ref().map(|s| s.paths().data_dir.clone());
    if let Some(dir) = data_dir {
        let leaves = docs::doc_leaves(&dir, &paths);
        if !leaves.is_empty() {
            docs::emit_docs_changed(app, leaves);
        }
    }
```

(`Paths::data_dir` is the field used by `scan_paths`; check its visibility and use the existing accessor if the field is private.)

- [ ] **Step 4: Sync host hook**

In `sync/engine.rs` trait `SyncHost`, next to `fn comments_changed(&self, _files: &[String]) {}` add `fn docs_changed(&self, _files: &[String]) {}`. In `commands/mod.rs` `impl SyncHost for TauriSyncHost` add:

```rust
    fn docs_changed(&self, files: &[String]) {
        docs::emit_docs_changed(&self.app, files.to_vec());
    }
```

- [ ] **Step 5: Build and test**

Run: `cd src-tauri && cargo test --lib commands::docs store::docs && cargo clippy --all-targets -- -D warnings`
Expected: pass, no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands src-tauri/src/store/watcher.rs src-tauri/src/sync/engine.rs src-tauri/src/lib.rs
git commit -m "feat: document commands, docs-changed event and watching _docs"
```

---

### Task 4: Sync `_docs/` (backends and engine pass)

**Files:**
- Modify: `src-tauri/src/sync/backend.rs` (trait + `MemoryBackend`), `src-tauri/src/sync/webdav.rs`, `src-tauri/src/sync/gdrive.rs`, `src-tauri/src/sync/mod.rs`, `src-tauri/src/sync/engine.rs`
- Test: in each file's tests, next to the comments tests named below

**Interfaces:**
- Consumes: Task 2 (`docs::parse`, `docs::conflict_copy`, `docs::archive`, `docs::parse_file_name`), Task 3 (`SyncHost::docs_changed`).
- Produces:
  - trait `StorageBackend`: `fn list_docs(&self) -> BoxFut<'_, Option<Vec<RemoteFile>>>`, `fn upload_doc<'a>(&'a self, name: &'a str, existing: Option<&'a RemoteFile>, bytes: Vec<u8>) -> BoxFut<'a, RemoteFile>`, `fn archive_doc<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()>`; defaults: `list_docs` = `Ok(None)`, the others `Err(BackendError::Other("この同期先はドキュメントを扱えません".into()))`.
  - `sync::DOC_KEY_PREFIX = "_docs/"`, `sync::is_doc_key(name) -> bool`.
  - `SyncReport.docs: Vec<String>`.

The `_docs` handling is the `_comments` handling with three differences: the folder name (`_docs`), the file filter (`docs::parse_file_name`), and the conflict action (keep both instead of a line merge). Copy, do not share, unless a helper already takes the folder as an argument (WebDAV's `upload_in(sub, ...)` / `archive_in(sub, ...)` do: reuse them).

- [ ] **Step 1: Memory backend — failing tests** (`backend.rs`, next to `comments_round_trip`)

```rust
    #[tokio::test]
    async fn docs_round_trip_and_stay_out_of_list() {
        let b = MemoryBackend::new();
        assert_eq!(b.list_docs().await.unwrap(), None);
        let n = "仕事.1792929845000-3f2a00000000009c.md";
        let f = b.upload_doc(n, None, b"---\ntitle: a\n---\nx".to_vec()).await.unwrap();
        let listed = b.list_docs().await.unwrap().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, n);
        assert_eq!(b.download(&listed[0]).await.unwrap(), b"---\ntitle: a\n---\nx");
        assert!(b.list().await.unwrap().iter().all(|x| x.name != n));
        b.archive_doc(&f).await.unwrap();
        assert_eq!(b.list_docs().await.unwrap(), Some(Vec::new()));
    }
```

(Use the constructor the comments tests use if it is not `MemoryBackend::new()`.)

Run: `cd src-tauri && cargo test --lib sync::backend`
Expected: compile error (no `list_docs`).

- [ ] **Step 2: Implement the trait methods and the memory backend**

Add the three defaulted methods to the trait after `archive_comment`. In `MemoryBackend`: add `const DOCS_PREFIX: &str = "_docs/";`, a `docs_folder: bool` field beside `comments_folder`, and implement the three methods by copying `list_comments` / `upload_comment` / `archive_comment` of `MemoryBackend` with `COMMENTS_PREFIX` -> `DOCS_PREFIX` and `comments_folder` -> `docs_folder`. Make `list` skip `DOCS_PREFIX` names exactly where it skips `COMMENTS_PREFIX`.

Run: `cd src-tauri && cargo test --lib sync::backend` — Expected: PASS.

- [ ] **Step 3: WebDAV — failing test** (next to `comments_listing_of_a_missing_folder_is_none`, copy that test and its mock setup, replacing `_comments` with `_docs` and `list_comments` with `list_docs`; add a second copy of the comments listing test that lists one `.md` file and checks its name). Run `cargo test --lib sync::webdav` — FAIL.

- [ ] **Step 4: WebDAV — implement**

```rust
const DOCS_DIR: &str = "_docs";
const DOCS_SUB: &str = "_docs/";

    fn docs_url(&self) -> Url {
        Url::parse(&format!("{}{DOCS_DIR}/", self.base)).expect("base plus a plain segment")
    }

    async fn list_doc_files(&self) -> Result<Option<Vec<RemoteFile>>, BackendError> {
        let url = self.docs_url();
        let Some(entries) = self.propfind(url.clone(), "1").await? else {
            return Ok(None);
        };
        let files = self.files_of(url, entries, |n| crate::store::docs::parse_file_name(n).is_some())?;
        Ok(Some(files.into_iter().map(in_docs).collect()))
    }

fn in_docs(f: RemoteFile) -> RemoteFile {
    RemoteFile { id: format!("{DOCS_SUB}{}", f.name), ..f }
}
```

Trait impl: `list_docs` -> `Box::pin(self.list_doc_files())`; `upload_doc` -> `make_folder(self.docs_url())` then `self.upload_in(DOCS_SUB, name, existing, bytes).await.map(in_docs)`; `archive_doc` -> `Box::pin(self.archive_in(DOCS_SUB, file))`. In `download`, add `else if file.id.starts_with(DOCS_SUB) { DOCS_SUB }` to the folder choice.

Run: `cargo test --lib sync::webdav` — PASS.

- [ ] **Step 5: Google Drive — failing tests**: copy `comments_listing_without_the_folder_is_none`, `comments_listing_reads_the_comments_folder` and `comment_upload_creates_inside_the_comments_folder` as `docs_…` tests, with the folder query using `value='docs'` and the folder name `_docs`. Run `cargo test --lib sync::gdrive` — FAIL.

- [ ] **Step 6: Google Drive — implement**

```rust
const DOCS_FOLDER_NAME: &str = "_docs";
const PROP_DOCS: &str = "docs";
const MD_MIME: &str = "text/markdown";
```

Add `doc_folders`, `list_doc_files`, `doc_folder_of`, `docs_folder` as copies of `comment_folders`, `list_comment_files`, `comment_folder_of`, `comments_folder` with `PROP_COMMENTS` -> `PROP_DOCS`, `COMMENTS_FOLDER_NAME` -> `DOCS_FOLDER_NAME`, and the name filter `crate::store::docs::parse_file_name(n).is_some()`. Trait impl: copy `list_comments` / `upload_comment` / `archive_comment` using the new helpers and `MD_MIME`.

Run: `cargo test --lib sync::gdrive` — PASS.

- [ ] **Step 7: Engine — failing tests**

Find the engine test that covers comments conflict merging (`grep -n "fn .*comment" src-tauri/src/sync/engine.rs` in the tests module) and copy its setup (two data folders on one `MemoryBackend`, the run helper). Write:

```rust
    #[tokio::test]
    async fn a_document_changed_on_both_sides_keeps_both() {
        // setup: PC A and PC B share a MemoryBackend (copy from the comments merge test)
        // A creates a document and syncs; B syncs (gets it).
        // A saves body "A の変更" at 10:30, B saves body "B の変更" at 10:40; A syncs, then B syncs.
        // expect on B: 2 documents in docs::list; the one keeping the original id has "B の変更"
        // (newer updated); the other is titled "<title> (競合 …)" with "A の変更".
        // B syncs again, then A syncs: A also lists the same 2 documents.
    }

    #[tokio::test]
    async fn a_document_changed_on_one_side_is_copied() {
        // A creates and syncs; B syncs: B reads the same body. A saves; A syncs; B syncs: B has A's body.
    }

    #[tokio::test]
    async fn an_old_target_without_docs_folder_is_not_read_as_deleted() {
        // B has a document, the target has no _docs folder and no records: after the run the
        // document is still in B's _docs and is uploaded.
    }
```

Fill each body with the copied setup and real assertions (`crate::store::docs::list(&paths_b, "仕事")`, `crate::store::docs::read(...)`). Use `docs::create` / `docs::save` with explicit times for the two sides.

Run: `cargo test --lib sync::engine::tests::a_document` — FAIL.

- [ ] **Step 8: Engine — implement**

In `sync/mod.rs` next to `COMMENT_KEY_PREFIX`:

```rust
pub const DOC_KEY_PREFIX: &str = "_docs/";

/// `true` for `_docs/<project>.<id>.md`.
pub fn is_doc_key(name: &str) -> bool {
    name.strip_prefix(DOC_KEY_PREFIX)
        .is_some_and(|leaf| crate::store::docs::parse_file_name(leaf).is_some())
}
```

In `engine.rs`, everywhere the comments are threaded through, thread the docs the same way:
- the `is_comment_key(&f.name)` filters (~l.69, ~l.100, ~l.1280): add `|| is_doc_key(&f.name)`;
- `with_comments` (~l.76): add `with_docs` that maps leaf names to `_docs/<leaf>`, and use it where `with_comments` is used for the 30 s fingerprint (~l.952) and the run (~l.1150, ~l.1304);
- the listing at the start of the run (~l.1130): `let remote_docs = match target.backend.list_docs().await { … }` with the same failure handling and label `"_docs/"`;
- after the comments pass (~l.1248), call `self.sync_docs(host, &target.backend, &data_dir.join(crate::store::docs::DIR), state, &mut report, remote_docs, is_retry).await?;`;
- `SyncReport` gets `pub docs: Vec<String>` (default empty) and the "something changed" check (~l.1298) includes `!report.docs.is_empty()`.

Add `list_doc_files(dir)` as a copy of `list_comment_files` with `crate::store::docs::parse_file_name`. Add `sync_docs` as a copy of `sync_comments` with:
- keys `format!("{DOC_KEY_PREFIX}{leaf}")`, `is_doc_key`;
- `waiting` uses `docs::parse_file_name` (project of the document);
- uploads/archives through `upload_doc` / `archive_doc`;
- `Action::Download`: write the bytes with `write_atomic` under `host.lock_store()` (no merge);
- `Action::ArchiveLocal`: `crate::store::docs::archive(&paths, &project, Some(&id), self.now())`;
- `Action::Conflict`:

```rust
                    Action::Conflict { .. } => {
                        let r = r.expect("a conflict has a remote file");
                        let theirs = backend.download(r).await?;
                        let ours = std::fs::read(&path).map_err(|e| BackendError::Other(e.to_string()))?;
                        let (project, id) = crate::store::docs::parse_file_name(&name)
                            .expect("only document names reach here");
                        let a = crate::store::docs::parse(&project, &id, &String::from_utf8_lossy(&ours));
                        let b = crate::store::docs::parse(&project, &id, &String::from_utf8_lossy(&theirs));
                        // The newer `updated` keeps the name; the other becomes a new document.
                        let (loser, winner_bytes) =
                            if b.updated > a.updated { (a, theirs) } else { (b, ours) };
                        let paths = crate::store::paths::Paths::new(dir.parent().unwrap_or(dir));
                        let now = Local::now();
                        {
                            let _store = host.lock_store();
                            crate::store::paths::write_atomic(&path, &winner_bytes)
                                .map_err(|e| BackendError::Other(e.to_string()))?;
                            crate::store::docs::conflict_copy(
                                &paths, &project, &loser, now.fixed_offset(), now.timestamp_millis() as u64,
                            )
                            .map_err(|e| BackendError::Other(e.to_string()))?;
                        }
                        let f = backend.upload_doc(&name, Some(r), winner_bytes.clone()).await?;
                        put_record(state, key(&name), &f, sha256_hex(&winner_bytes));
                        // The copy is a new local file: the next run uploads it.
                        report.rerun = true;
                        Ok(Some(true))
                    }
```

- at the end, `host.docs_changed(&changed)` where `sync_comments` calls `host.comments_changed`.

Run: `cd src-tauri && cargo test --lib sync:: && cargo clippy --all-targets -- -D warnings`
Expected: all pass (including every existing comments test).

- [ ] **Step 9: Docs**

`docs/internal/data-model.md`: add `_docs/<プロジェクト名>.<id>.md` to the folder tree and a section 「ドキュメント (`_docs/`)」 with the file example from the spec (invented names), the key list, the JSON-string values, the `files` lines, the conflict copy rule, and that old versions ignore the folder. `docs/internal/architecture.md`: add `_docs` to the sync flow where `_comments` appears.

Run: `npm run test:docs` — Expected: 0 fail.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/sync docs/internal
git commit -m "feat(sync): sync _docs on NAS and Google Drive; a two-sided change keeps both"
```

---

### Task 5: Markdown <-> editor (pure) and dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/app/docMarkdown.ts`, `src/app/docMarkdown.test.ts`

**Interfaces:**
- Produces (used by Task 6):
  - `export const docExtensions: AnyExtension[]` (StarterKit with link `openOnClick: false`, TaskList, TaskItem nested, TableKit, Image)
  - `export function fromMarkdown(md: string): JSONContent`
  - `export function toMarkdown(doc: JSONContent): string`
  - `export function attachmentOfSrc(src: string): { hash: string; ext: string } | null` (`../_attachments/<hash>.<ext>` or `../_attachments/<hash>`)
  - `export function srcOfAttachment(f: { hash: string; ext: string }): string`
  - `export const DOC_TEMPLATE: string` (`## 目的\n\n## 経緯\n\n## リンク\n\n## 要望\n\n## やりたいこと\n`)

- [ ] **Step 1: Install pinned packages**

```bash
npm install --save-exact @tiptap/react@3.34.0 @tiptap/pm@3.34.0 @tiptap/core@3.34.0 @tiptap/starter-kit@3.34.0 @tiptap/markdown@3.34.0 @tiptap/extension-list@3.34.0 @tiptap/extension-table@3.34.0 @tiptap/extension-image@3.34.0
```

Check: `npm ls @tiptap/core` shows one version, 3.34.0.

- [ ] **Step 2: Failing tests** (`src/app/docMarkdown.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdown, toMarkdown, attachmentOfSrc, srcOfAttachment, DOC_TEMPLATE } from "./docMarkdown.ts";

const SAMPLE = `# 目的

**太字** と *斜体* と ~~取り消し~~ と \`code\`。[リンク](https://example.com)

- 箇条 1
- 箇条 2

1. 番号 1
2. 番号 2

- [ ] やること
- [x] 済んだこと

> 引用

\`\`\`ts
const a = 1;
\`\`\`

| 列 1 | 列 2 |
| --- | --- |
| a | b |

![画面](../_attachments/${"a".repeat(64)}.png)

---

### 小見出し
`;

test("every element of the spec survives a round trip, and a second one changes nothing", () => {
  const once = toMarkdown(fromMarkdown(SAMPLE));
  for (const piece of ["# 目的", "**太字**", "*斜体*", "~~取り消し~~", "`code`", "[リンク](https://example.com)", "- 箇条 1", "1. 番号 1", "- [ ] やること", "- [x] 済んだこと", "> 引用", "```ts", "| 列 1 | 列 2 |", `![画面](../_attachments/${"a".repeat(64)}.png)`, "---", "### 小見出し"]) {
    assert.ok(once.includes(piece), `lost: ${piece}`);
  }
  assert.equal(toMarkdown(fromMarkdown(once)), once);
});

test("empty and Japanese-only text round trip", () => {
  assert.equal(toMarkdown(fromMarkdown("")).trim(), "");
  assert.equal(toMarkdown(fromMarkdown("日本語の段落\n")).trim(), "日本語の段落");
});

test("an image path names a blob, and back", () => {
  const h = "b".repeat(64);
  assert.deepEqual(attachmentOfSrc(`../_attachments/${h}.png`), { hash: h, ext: "png" });
  assert.deepEqual(attachmentOfSrc(`../_attachments/${h}`), { hash: h, ext: "" });
  assert.equal(attachmentOfSrc("https://example.com/a.png"), null);
  assert.equal(attachmentOfSrc("../_attachments/short.png"), null);
  assert.equal(srcOfAttachment({ hash: h, ext: "png" }), `../_attachments/${h}.png`);
  assert.equal(srcOfAttachment({ hash: h, ext: "" }), `../_attachments/${h}`);
});

test("the template has the five headings", () => {
  assert.deepEqual(DOC_TEMPLATE.match(/^## .+$/gm), ["## 目的", "## 経緯", "## リンク", "## 要望", "## やりたいこと"]);
});
```

Run: `node --test src/app/docMarkdown.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** (`src/app/docMarkdown.ts`)

```ts
/** Project documents (spec 2026-11-28): the editor's extensions and Markdown <-> editor JSON. Pure; tested with node. */
import type { AnyExtension, JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";

export const docExtensions: AnyExtension[] = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
  Image,
];

const manager = new MarkdownManager({ extensions: docExtensions });

export function fromMarkdown(md: string): JSONContent {
  return manager.parse(md);
}

export function toMarkdown(doc: JSONContent): string {
  return manager.serialize(doc);
}

const PREFIX = "../_attachments/";

export function attachmentOfSrc(src: string): { hash: string; ext: string } | null {
  if (!src.startsWith(PREFIX)) return null;
  const m = /^([0-9a-f]{64})(?:\.([0-9a-z]{1,16}))?$/.exec(src.slice(PREFIX.length));
  return m ? { hash: m[1], ext: m[2] ?? "" } : null;
}

export function srcOfAttachment(f: { hash: string; ext: string }): string {
  return f.ext ? `${PREFIX}${f.hash}.${f.ext}` : `${PREFIX}${f.hash}`;
}

export const DOC_TEMPLATE = "## 目的\n\n## 経緯\n\n## リンク\n\n## 要望\n\n## やりたいこと\n";
```

Check the StarterKit v3 option names before relying on them: `grep -n "heading\|link" node_modules/@tiptap/starter-kit/dist/index.d.ts`. If `link` options are named differently, use the names found there.

- [ ] **Step 4: Run**

Run: `node --test src/app/docMarkdown.test.ts && npx tsc --noEmit`
Expected: 4 pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/docMarkdown.ts src/app/docMarkdown.test.ts
git commit -m "feat(docs): markdown round trip for the document editor (tiptap 3.34.0)"
```

---

### Task 6: API, autosave, editor and the 参考資料 box

**Files:**
- Modify: `src/api/client.ts`, `src/api/events.ts`, `src/api/types` file that holds `AttachmentInfo` (find with `grep -rn "export type AttachmentInfo" src/api`)
- Create: `src/app/autosave.ts`, `src/app/autosave.test.ts`, `src/app/useDocs.ts`, `src/components/DocEditor.tsx`, `src/components/ReferenceFiles.tsx`

**Interfaces:**
- Consumes: Task 3 commands, Task 5 module.
- Produces (used by Tasks 7, 8):
  - types `DocSummary`, `Doc`, `DocEdit`, `Saved` (mirror of the Rust structs; `Saved = { kind: "written" } & Doc | { kind: "conflict"; doc: Doc; copy: Doc }`)
  - `api.listDocs(project)`, `api.readDoc(project, id)`, `api.createDoc(project, section, title, body)`, `api.saveDoc(project, id, baseUpdated, edit)`, `api.deleteDoc(project, id)`; event `onDocsChanged(cb: (files: string[]) => void)`
  - `createAutosave(save: () => void, delayMs = 1000, timers = { set: setTimeout, clear: clearTimeout }): { touch(): void; flush(): void; cancel(): void }`
  - `useDocs(project: string, section: string | null)` -> `{ list: DocSummary[]; error?: string; reload(): void; create(withTemplate: boolean): Promise<Doc>; remove(id: string): Promise<void> }`
  - `<DocEditor doc={Doc} onSave={(edit: DocEdit) => Promise<void>} readAttachment={...} addFiles={...} mobile?: boolean />`
  - `<ReferenceFiles files={AttachmentInfo[]} onAdd={(files: File[]) => void} onOpen={(f) => void} onRemove={(f) => void} mobile?: boolean />`

Note on `Saved` serialization: Rust `#[serde(tag = "kind", rename_all = "camelCase")]` on a newtype variant `Written(Doc)` serializes as `{ "kind": "written", ...docFields }`. Confirm with a Rust unit test in `docs.rs`:

```rust
    #[test]
    fn saved_serializes_with_a_kind() {
        let d = parse("仕事", ID, "");
        let v = serde_json::to_value(Saved::Written(d.clone())).unwrap();
        assert_eq!(v["kind"], "written");
        assert_eq!(v["id"], ID);
        let v = serde_json::to_value(Saved::Conflict { doc: d.clone(), copy: d }).unwrap();
        assert_eq!(v["kind"], "conflict");
        assert_eq!(v["copy"]["id"], ID);
    }
```

- [ ] **Step 1: Failing autosave tests** (`src/app/autosave.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAutosave } from "./autosave.ts";

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    set: (fn: () => void) => { const id = next++; pending.set(id, fn); return id; },
    clear: (id: number | undefined) => { if (id !== undefined) pending.delete(id); },
    fire: () => { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); },
    count: () => pending.size,
  };
}

test("typing saves once after the pause", () => {
  const t = fakeTimers(); let saves = 0;
  const a = createAutosave(() => saves++, 1000, t);
  a.touch(); a.touch(); a.touch();
  assert.equal(t.count(), 1);
  t.fire();
  assert.equal(saves, 1);
});

test("leaving before the pause saves at once, and only once", () => {
  const t = fakeTimers(); let saves = 0;
  const a = createAutosave(() => saves++, 1000, t);
  a.touch();
  a.flush();
  assert.equal(saves, 1);
  t.fire();
  assert.equal(saves, 1);
});

test("flush with nothing typed does not save", () => {
  const t = fakeTimers(); let saves = 0;
  const a = createAutosave(() => saves++, 1000, t);
  a.flush();
  assert.equal(saves, 0);
});

test("cancel drops a pending save", () => {
  const t = fakeTimers(); let saves = 0;
  const a = createAutosave(() => saves++, 1000, t);
  a.touch(); a.cancel(); t.fire(); a.flush();
  assert.equal(saves, 0);
});
```

Run: `node --test src/app/autosave.test.ts` — FAIL.

- [ ] **Step 2: Implement** (`src/app/autosave.ts`)

```ts
/** Autosave of a document (spec 2026-11-28: 1 s after typing stops, or at once when leaving). Pure. */
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: never) => void };

export function createAutosave(save: () => void, delayMs = 1000, timers: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (id) => clearTimeout(id) }) {
  let id: unknown;
  let dirty = false;
  const run = () => {
    id = undefined;
    if (!dirty) return;
    dirty = false;
    save();
  };
  return {
    touch() {
      dirty = true;
      if (id !== undefined) timers.clear(id as never);
      id = timers.set(run, delayMs);
    },
    flush() {
      if (id !== undefined) timers.clear(id as never);
      run();
    },
    cancel() {
      if (id !== undefined) timers.clear(id as never);
      id = undefined;
      dirty = false;
    },
  };
}
```

Run: `node --test src/app/autosave.test.ts` — 4 pass.

- [ ] **Step 3: API and event**

In the types file beside `AttachmentInfo`:

```ts
export type DocSummary = { id: string; project: string; title: string; section: string | null; updated: string; author: string; files: number };
export type Doc = { id: string; project: string; title: string; section: string | null; created: string; updated: string; author: string; files: AttachmentInfo[]; body: string };
/** `section: null` moves the document to the whole project; a missing key leaves it. */
export type DocEdit = { title?: string; section?: string | null; body?: string; files?: AttachmentInfo[] };
export type Saved = ({ kind: "written" } & Doc) | { kind: "conflict"; doc: Doc; copy: Doc };
```

In `client.ts`, after the attachments block:

```ts
  // ---- project documents (spec 2026-11-28) ----
  listDocs: (project: string) => invoke<DocSummary[]>("list_docs", { project }),
  readDoc: (project: string, id: string) => invoke<Doc>("read_doc", { project, id }),
  createDoc: (project: string, section: string | null, title: string, body: string) => invoke<Doc>("create_doc", { project, section, title, body }),
  saveDoc: (project: string, id: string, baseUpdated: string, edit: DocEdit) => invoke<Saved>("save_doc", { project, id, baseUpdated, edit }),
  deleteDoc: (project: string, id: string) => invoke<void>("delete_doc", { project, id }),
```

In `events.ts`, copy the `comments-changed` listener as `onDocsChanged` for `docs-changed` with payload `{ files: string[] }`.

Add the five commands to the Storybook / browser mock of `invoke` if there is one (`grep -rn "list_comments" src/stories src/app/*mock*`), returning in-memory documents, so stories render.

- [ ] **Step 4: `useDocs`** (`src/app/useDocs.ts`)

```ts
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { onDocsChanged } from "../api/events";
import type { Doc, DocSummary } from "../api/types";
import { DOC_TEMPLATE } from "./docMarkdown";

/** The documents of a project, or of one section of it (`section`), newest first; follows `docs-changed`. */
export function useDocs(project: string, section: string | null) {
  const [all, setAll] = useState<DocSummary[]>([]);
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    api.listDocs(project).then((l) => { setAll(l); setError(undefined); }, (e) => setError(String(e?.message ?? e)));
  }, [project]);
  useEffect(() => {
    reload();
    const off = onDocsChanged((files) => { if (files.some((f) => f.startsWith(`${project}.`))) reload(); });
    return () => { void off.then((f) => f()); };
  }, [project, reload]);
  const list = section === null ? all : all.filter((d) => d.section === section);
  const create = async (withTemplate: boolean): Promise<Doc> => {
    const d = await api.createDoc(project, section, "", withTemplate ? DOC_TEMPLATE : "");
    reload();
    return d;
  };
  const remove = async (id: string) => { await api.deleteDoc(project, id); reload(); };
  return { list, error, reload, create, remove };
}
```

(Match `onDocsChanged`'s return type to what `events.ts` returns for the other listeners; adjust the cleanup line accordingly. Use the project's existing error-text helper if one exists: `grep -rn "function errorText\|messageOf" src/app | head`.)

- [ ] **Step 5: `DocEditor`** (`src/components/DocEditor.tsx`)

Behaviour:
- `useEditor({ extensions: [...docExtensions with Image replaced by DocImage], content: fromMarkdown(doc.body) })`, recreated when `doc.id` changes (key the component by id in the parent).
- Title field (plain `<input>`, 22px semibold on desktop, 28 bold on iPhone) above the editor; changing it calls `autosave.touch()`.
- `onUpdate` -> `autosave.touch()`; the save callback builds `{ title, body: toMarkdown(editor.getJSON()) }` and calls `onSave`.
- `useEffect` cleanup and `onBlur` of the container call `autosave.flush()`; `window` `pagehide` / `visibilitychange` (hidden) also flush.
- Empty document: show a button 「雛形から始める」 that sets `fromMarkdown(DOC_TEMPLATE)` and touches.
- Toolbar (desktop above the editor, iPhone sticky above the keyboard as a horizontally scrolling row): 見出し 1-3, 太字, 斜体, 取り消し線, 箇条書き, 番号, チェック, 引用, コード, リンク (prompt for the URL with the app's text sheet / dialog), 表 (3x3 with header row), 画像 (file picker), 区切り線. Use the `lucide-react` icons already in the app; labels as `aria-label` in Japanese.
- Links: click with Cmd/Ctrl on desktop, tap on iPhone, calls the app's existing external-link opener (`grep -rn "openUrl\|opener" src/app src/api | head`).
- `DocImage = Image.extend({ addNodeView() { ... } })`: create an `<img>`; `attachmentOfSrc(node.attrs.src)` -> `readAttachment` -> `URL.createObjectURL(new Blob([bytes], { type }))`; on failure or a non-attachment src that is not `https:`, show the alt text in a muted box; `destroy()` revokes the URL. `node.attrs.src` is never changed, so `toMarkdown` writes the relative path back.
- Pasting / dropping an image: intercept with `editorProps.handlePaste` / `handleDrop`, store each image with `api.addAttachment` (shrink like the comment composer does: reuse its helper, `grep -rn "addAttachment(" src | head`), then insert `{ type: "image", attrs: { src: srcOfAttachment(info), alt: info.name } }`.
- Styles in a `<style>` block scoped by a class (`.doc-editor h1 { ... }`) using the app's tokens (`--font-body`, `--color-text-primary`, `--color-border`, `--color-accent`); checkboxes of task items use the accent colour.

- [ ] **Step 6: `ReferenceFiles`** (`src/components/ReferenceFiles.tsx`)

Heading 「参考資料」 with a count; rows of icon (by `type`), name, size (reuse the size formatter of the comment attachments: `grep -rn "formatSize\|bytesText" src | head`); click opens with `api.openAttachment`; a 「…」 with 「外す」; a 「ファイルを追加」 button with a hidden `<input type="file" multiple>`; on desktop the whole box accepts drops. Adding calls `onAdd(files)`; the parent stores each with `api.addAttachment` and saves `{ files: [...doc.files, ...infos] }` immediately (not through the 1 s autosave).

- [ ] **Step 7: Check**

Run: `npx tsc --noEmit && npm run test:web && cd src-tauri && cargo test --lib store::docs`
Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/api src/app/autosave.ts src/app/autosave.test.ts src/app/useDocs.ts src/components/DocEditor.tsx src/components/ReferenceFiles.tsx src-tauri/src/store/docs.rs
git commit -m "feat(docs): document editor with autosave, images and reference files"
```

---

### Task 7: Desktop screen (リスト / ドキュメント)

**Files:**
- Create: `src/views/DocsPane.tsx`, `src/views/DocsPane.stories.tsx`
- Modify: `src/views/ProjectView.tsx` (header, section headers' `trailing`), `src/app/Main.tsx` (mode state per project, render `DocsPane`), `design/storyboard.md`, `docs/03-desktop.md`

**Interfaces:**
- Consumes: Task 6.
- Produces: `ProjectViewProps.mode?: "list" | "docs"`, `onMode?: (m: "list" | "docs") => void`, `onOpenSectionDocs?: (section: string) => void`; `<DocsPane project section onSection(null) />`.

- [ ] **Step 1: `DocsPane`**

Layout: two columns (list 260px, document the rest). The list: a header 「ドキュメント」 + 「+」 (menu: 「空のドキュメント」「雛形から」), and when `section !== null` a chip 「セクション: <name> ×」 that calls `onSection(null)`. Rows: title, a muted line `<section or プロジェクト全体> · <updated as M/D HH:mm> · <author>`, a paperclip with the count when `files > 0`. Selected row uses `--color-bg-hover`. Empty list: 「ドキュメントはまだありません」 and the two create buttons. The right side: `api.readDoc` of the selected id, then `<DocEditor key={id} .../>` and `<ReferenceFiles/>` under it; a 「…」 at the top right with 「セクションを変える」 (a menu of the project's sections plus 「プロジェクト全体」, saving `{ section }`) and 「削除」 (confirm dialog: 「「<題名>」を削除しますか? archive フォルダに移します。」). When `saveDoc` returns `kind: "conflict"`, show the app's toast 「ほかの場所で変更されていたため、「<copy.title>」として残しました」 and select `doc` again.

- [ ] **Step 2: Switch in the header**

In `ProjectView`, under the title block inside `PageHeader`, render `<Segmented options={[{ value: "list", label: "リスト" }, { value: "docs", label: "ドキュメント" }]} value={mode} onChange={onMode} ariaLabel="表示の切り替え" />` (check `Segmented`'s `options` shape in `src/components/Segmented.tsx` and match it) at a fixed width of 220px, only when `onMode` is given. When `mode === "docs"`, `ProjectView` renders nothing below the header; `Main.tsx` renders `<DocsPane project={current} section={docsSection} onSection={setDocsSection} />` below it instead of the list. Mode and `docsSection` live in `Main.tsx` state keyed by project (switching project goes back to リスト).

- [ ] **Step 3: Section shortcut**

Pass `trailing` to each desktop `SectionHeader` in `ProjectView`: a 24px icon button (lucide `FileText`, `aria-label="ドキュメント"`) shown on row hover, calling `onOpenSectionDocs(name)`; `Main.tsx` sets mode `docs` and `docsSection = name`.

- [ ] **Step 4: Stories**

`DocsPane.stories.tsx`: 「一覧と本文」 (three documents, one selected with headings, a task list, a table and two reference files), 「空」, 「セクションで絞る」. Add the screen to `design/storyboard.md` with its checks (create, template, autosave, reference files, section filter, delete). Run `npm run build-storybook && npm run check:stories` — Expected: `missing: none`.

- [ ] **Step 5: Docs**

`docs/03-desktop.md`: a section 「ドキュメント」: the switch, creating (empty or template), writing (formats list), autosave, reference files, section shortcut, conflict copy, deletion to `archive/`. Capture `docs/images/screen-docs.png` with `npm run capture:docs` after adding the story id to the capture list (see `docs/internal/README.md`). Run `npm run test:docs`.

- [ ] **Step 6: Try it**

Run `npm run tauri dev` (quit the installed app first). Create a document in a project, type Japanese with the IME, wait 1 s, quit and reopen: the text is there; check `_docs/` in the data folder holds the `.md` with the front matter. Edit the `.md` in a text editor while the document is open, then type in the app: a 「(競合 …)」 copy appears.

- [ ] **Step 7: Commit**

```bash
git add src/views/DocsPane.tsx src/views/DocsPane.stories.tsx src/views/ProjectView.tsx src/app/Main.tsx design/storyboard.md docs/03-desktop.md docs/images
git commit -m "feat(desktop): documents tab in projects with a section shortcut"
```

---

### Task 8: iPhone screens

**Files:**
- Modify: `src/app/mobileNav.ts`, `src/app/mobileNav.test.ts`, `src/app/MobileMain.tsx` (project 「…」 sheet rows, `sectionSheet` menu rows, `renderScreen`)
- Create: `src/views/mobile/MobileDocs.tsx`, `src/views/mobile/MobileDocs.stories.tsx`
- Modify: `design/storyboard.md`, `docs/04-iphone.md`

**Interfaces:**
- Consumes: Task 6.
- Produces: `BrowseScreen` gains `{ kind: "docs"; project: string; section: string | null }` and `{ kind: "doc"; project: string; id: string }`; `reduceNav` `renamed` / `removed` handle them.

- [ ] **Step 1: Failing nav tests** (`mobileNav.test.ts`)

```ts
test("a renamed project renames its document screens", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } }, { type: "push", screen: { kind: "docs", project: "仕事", section: null } }, { type: "push", screen: { kind: "doc", project: "仕事", id: "1792929845000-3f2a00000000009c" } });
  const r = reduceNav(s, { type: "renamed", from: "仕事", to: "業務" });
  assert.deepEqual(r.browse.map((x) => ("project" in x ? x.project : "name" in x ? x.name : x.kind)), ["業務", "業務", "業務"]);
});

test("a removed project drops its document screens", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } }, { type: "push", screen: { kind: "docs", project: "仕事", section: "在庫アプリ" } });
  assert.deepEqual(reduceNav(s, { type: "removed", project: "仕事" }).browse, []);
});
```

Run: `node --test src/app/mobileNav.test.ts` — FAIL (type errors / wrong result).

- [ ] **Step 2: Implement in `mobileNav.ts`**

Add the two kinds to `BrowseScreen`. In the `renamed` case map `docs` and `doc` screens whose `project === a.from` to `a.to` (next to the existing `project` mapping). In `removed`, drop screens whose `project` (or `name` for `project`) equals the removed one, the same way the existing code drops the project screen. Run the tests — PASS. Also check `screenKey` in `MobileMain.tsx` (from the screen animation work) includes `id` / `project` / `section` so pushing a document animates: extend it with `` `${"id" in screen ? screen.id : ""}:${"section" in screen ? screen.section ?? "" : ""}` ``.

- [ ] **Step 3: `MobileDocs`**

Two exports in `src/views/mobile/MobileDocs.tsx`, both inside `MobileShell` like the other browse screens (large title, back button):
- `MobileDocsList`: title 「ドキュメント」, subtitle the project (and `· <section>`), rows like the desktop list (title, muted line), the shell's add button (FAB) opens a sheet 「空のドキュメント」「雛形から」; tapping a row pushes `{ kind: "doc", … }`.
- `MobileDoc`: header with back and 「…」 (sheet: 「セクションを変える」 -> list sheet, 「削除」 -> confirm sheet), body `<DocEditor mobile …/>` then `<ReferenceFiles mobile …/>`. The editor toolbar sits above the keyboard (`position: sticky; bottom: 0` inside the scroll area, padded by `env(safe-area-inset-bottom)`); leaving the screen (back, tab change) flushes the autosave through the unmount cleanup.

- [ ] **Step 4: Entry rows**

In `MobileMain.tsx`: the project 「…」 sheet gets a row 「ドキュメント」 (icon `FileText`) that pushes `{ kind: "docs", project: name, section: null }`; the section `sectionSheet` menu gets the same row with `section: sectionSheet.name`. `renderScreen` renders `MobileDocsList` / `MobileDoc` for the new kinds.

- [ ] **Step 5: Stories, storyboard, docs**

Stories: 「ドキュメントの一覧」, 「ドキュメント (本文と参考資料)」, 「空の一覧」 at the mobile viewport. `design/storyboard.md`: screens and checks. `docs/04-iphone.md`: a section 「ドキュメント」 (entry rows, create, toolbar, reference files, conflict copy). Run `npm run build-storybook && npm run check:stories && npm run test:docs && npm run test:web && npx tsc --noEmit`.

- [ ] **Step 6: Device check**

`scripts/ios-build.sh device`, install with `xcrun devicectl device install app --device <id> "$TMPDIR/powertodo-ios/dd-device/Build/Products/release-iphoneos/PowerToDo.app"`. Check with the owner: Japanese input (変換中の文字) in the body and the title, the toolbar above the keyboard, a photo from the library as a body image and as a reference file, back flushes the text, a document made on the desktop appears after a sync and the other way round.

- [ ] **Step 7: Commit**

```bash
git add src/app/mobileNav.ts src/app/mobileNav.test.ts src/app/MobileMain.tsx src/views/mobile/MobileDocs.tsx src/views/mobile/MobileDocs.stories.tsx design/storyboard.md docs/04-iphone.md
git commit -m "feat(mobile): documents screens from the project and section menus"
```

---

## Self-review notes

- Spec §1 一覧 / 中身 / 参考資料 / エディタ -> Tasks 5-8; データ / 同期 / 名前の変更と削除 / 外で直したファイル -> Tasks 1-4; 古い版 -> Task 4 Step 8 (folder is new, old code never lists it) and the data-model doc. 「セクションを消す」 has no store operation today (Task 2 Step 6 note).
- Spec sections 2 and 3 (calendar, gantt) are separate plans.
