//! Comments of a task (spec ① §3): list, add, edit, delete, and the counts per task. Every write
//! asks for a sync and tells the screens which file changed (`comments-changed`).

use std::collections::BTreeMap;

use chrono::Local;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::{AppState, with_store};
use crate::error::{AppError, AppResult};
use crate::store::comments::{self, Comment, Line, Op};
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

/// Appends one line by the current display name, then asks for a sync. `target`: the comment an edit
/// or delete changes (only its author may).
fn write(
    app: &AppHandle,
    state: &AppState,
    project: &str,
    no: u32,
    op: Op,
    target: Option<String>,
    text: Option<String>,
) -> AppResult<Vec<Comment>> {
    let out = with_store(state, |s| {
        let author = s.settings().display_name;
        if let Some(id) = &target {
            comments::check_author(&comments::lines(s.paths(), project, no)?, id, &author)?;
        }
        let now = Local::now();
        let line = Line {
            id: comments::new_id(now.timestamp_millis().max(0) as u64),
            op,
            target,
            at: now.to_rfc3339(),
            author,
            text,
        };
        comments::append(s.paths(), project, no, &line)?;
        comments::read(s.paths(), project, no)
    })?;
    state.sync.request(SyncReason::AfterSave);
    emit_comments_changed(app, vec![comments::file_name(project, no)]);
    Ok(out)
}

fn text_of(text: &str) -> AppResult<String> {
    let t = text.trim();
    if t.is_empty() {
        return Err(AppError::Invalid {
            message: "コメントが空です".into(),
        });
    }
    Ok(t.to_string())
}

#[tauri::command]
pub async fn add_comment(
    project: String,
    no: u32,
    text: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<Comment>> {
    let text = text_of(&text)?;
    write(&app, state.inner(), &project, no, Op::Add, None, Some(text))
}

#[tauri::command]
pub async fn edit_comment(
    project: String,
    no: u32,
    id: String,
    text: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<Comment>> {
    let text = text_of(&text)?;
    write(
        &app,
        state.inner(),
        &project,
        no,
        Op::Edit,
        Some(id),
        Some(text),
    )
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
        None,
    )
}
