//! Comments of a task (spec ① §3): list, add, edit, delete, and the counts per task. Every write
//! asks for a sync and tells the screens which file changed (`comments-changed`). The attachments
//! of comments and of the description (spec attachments §3) ride in the same file and the same
//! commands; the blobs themselves are in `attachments.rs`.

use std::collections::BTreeMap;

use chrono::Local;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::{AppState, with_store};
use crate::error::{AppError, AppResult};
use crate::store::attachments::{self, AttachmentInfo};
use crate::store::comments::{self, Comment, Line, NoteFile, Op};
use crate::sync::SyncReason;

/// Payload of `comments-changed`: comment file names (`仕事.12.jsonl`).
#[derive(Debug, Clone, Serialize)]
pub struct CommentsChanged {
    pub files: Vec<String>,
}

pub fn emit_comments_changed(app: &AppHandle, files: Vec<String>) {
    let _ = app.emit("comments-changed", CommentsChanged { files });
}

#[tauri::command]
pub async fn list_comments(
    project: String,
    no: u32,
    state: State<'_, AppState>,
) -> AppResult<Vec<Comment>> {
    with_store(state.inner(), |s| comments::read(s.paths(), &project, no))
}

#[tauri::command]
pub async fn comment_counts(
    project: String,
    state: State<'_, AppState>,
) -> AppResult<BTreeMap<u32, u32>> {
    with_store(state.inner(), |s| comments::counts(s.paths(), &project))
}

#[tauri::command]
pub async fn list_note_files(
    project: String,
    no: u32,
    state: State<'_, AppState>,
) -> AppResult<Vec<NoteFile>> {
    with_store(state.inner(), |s| {
        comments::read_notes(s.paths(), &project, no)
    })
}

/// Attachments per task No. (comments' and description's), for the list rows; tasks without any are left out.
#[tauri::command]
pub async fn attachment_counts(
    project: String,
    state: State<'_, AppState>,
) -> AppResult<BTreeMap<u32, u32>> {
    with_store(state.inner(), |s| {
        comments::attachment_counts(s.paths(), &project)
    })
}

/// What one write puts in the line.
#[derive(Default)]
struct Body {
    text: Option<String>,
    files: Option<Vec<AttachmentInfo>>,
}

/// Every file named must be stored here already (`add_attachment` first): a record that points at
/// nothing would show a frame that never fills.
fn check_files(
    s: &crate::store::project_store::ProjectStore,
    files: &[AttachmentInfo],
) -> AppResult<()> {
    for f in files {
        if !attachments::exists(s.paths(), &f.hash, &f.ext) {
            return Err(AppError::NotFound {
                message: format!("添付「{}」のファイルが見つかりません", f.name),
            });
        }
    }
    Ok(())
}

/// Appends one line by the current display name, then asks for a sync. `target`: the comment an edit
/// or delete changes (only its author may; a `note-detach` is anyone's).
fn write(
    app: &AppHandle,
    state: &AppState,
    project: &str,
    no: u32,
    op: Op,
    target: Option<String>,
    body: Body,
) -> AppResult<Vec<Comment>> {
    write_lines(app, state, project, no, op, target, body, |s| {
        comments::read(s.paths(), project, no)
    })
}

#[allow(clippy::too_many_arguments)]
fn write_lines<T>(
    app: &AppHandle,
    state: &AppState,
    project: &str,
    no: u32,
    op: Op,
    target: Option<String>,
    body: Body,
    read: impl FnOnce(&crate::store::project_store::ProjectStore) -> AppResult<T>,
) -> AppResult<T> {
    let Body { text, files } = body;
    let out = with_store(state, |s| {
        let author = s.settings().display_name;
        if let Some(f) = &files {
            check_files(s, f)?;
        }
        if matches!(op, Op::Edit | Op::Delete) {
            let id = target.as_deref().unwrap_or_default();
            let existing = comments::lines(s.paths(), project, no)?;
            comments::check_author(&existing, id, &author)?;
            if op == Op::Edit {
                // Text and files may not both end up empty.
                let c = comments::view(&existing).into_iter().find(|c| c.id == id);
                let has_text = text
                    .as_deref()
                    .or(c.as_ref().map(|c| c.text.as_str()))
                    .is_some_and(|t| !t.trim().is_empty());
                let has_files = files
                    .as_ref()
                    .or(c.as_ref().map(|c| &c.files))
                    .is_some_and(|f| !f.is_empty());
                if !has_text && !has_files {
                    return Err(empty());
                }
            }
        }
        let now = Local::now();
        let line = Line {
            id: comments::new_id(now.timestamp_millis().max(0) as u64),
            op,
            target,
            at: now.to_rfc3339(),
            author,
            text,
            files,
        };
        comments::append(s.paths(), project, no, &line)?;
        read(s)
    })?;
    state.sync.request(SyncReason::AfterSave);
    emit_comments_changed(app, vec![comments::file_name(project, no)]);
    Ok(out)
}

fn empty() -> AppError {
    AppError::Invalid {
        message: "コメントが空です".into(),
    }
}

/// The trimmed text; empty is fine when there are files (a comment may be only an attachment).
fn text_of(text: &str, has_files: bool) -> AppResult<String> {
    let t = text.trim();
    if t.is_empty() && !has_files {
        return Err(empty());
    }
    Ok(t.to_string())
}

#[tauri::command]
pub async fn add_comment(
    project: String,
    no: u32,
    text: String,
    files: Option<Vec<AttachmentInfo>>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<Comment>> {
    let text = text_of(&text, files.as_ref().is_some_and(|f| !f.is_empty()))?;
    let body = Body {
        text: Some(text),
        files: files.filter(|f| !f.is_empty()),
    };
    write(&app, state.inner(), &project, no, Op::Add, None, body)
}

#[tauri::command]
pub async fn edit_comment(
    project: String,
    no: u32,
    id: String,
    text: String,
    files: Option<Vec<AttachmentInfo>>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<Comment>> {
    // `files` given replaces the comment's attachments (an empty list takes them all off); left out keeps them.
    let text = text.trim().to_string();
    let body = Body {
        text: Some(text),
        files,
    };
    write(&app, state.inner(), &project, no, Op::Edit, Some(id), body)
}

#[tauri::command]
pub async fn delete_comment(
    project: String,
    no: u32,
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<Comment>> {
    write(
        &app,
        state.inner(),
        &project,
        no,
        Op::Delete,
        Some(id),
        Body::default(),
    )
}

/// Attaches one file (stored already) to the task's description.
#[tauri::command]
pub async fn attach_to_note(
    project: String,
    no: u32,
    file: AttachmentInfo,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<NoteFile>> {
    let body = Body {
        text: None,
        files: Some(vec![file]),
    };
    write_lines(
        &app,
        state.inner(),
        &project,
        no,
        Op::NoteAttach,
        None,
        body,
        |s| comments::read_notes(s.paths(), &project, no),
    )
}

/// Takes the description's attachment `id` (the id of its `note-attach` line) off.
#[tauri::command]
pub async fn detach_from_note(
    project: String,
    no: u32,
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<NoteFile>> {
    write_lines(
        &app,
        state.inner(),
        &project,
        no,
        Op::NoteDetach,
        Some(id),
        Body::default(),
        |s| comments::read_notes(s.paths(), &project, no),
    )
}
