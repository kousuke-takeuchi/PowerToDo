//! Project documents (spec project docs): list, read, create, save, delete, and `docs-changed`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::{AppState, with_store};
use crate::error::AppResult;
use crate::store::docs::{self, Doc, DocSummary, Edit, Saved};
use crate::sync::SyncReason;

#[derive(Debug, Clone, Serialize)]
pub struct DocsChanged {
    pub files: Vec<String>,
}

pub fn emit_docs_changed(app: &AppHandle, files: Vec<String>) {
    let _ = app.emit("docs-changed", DocsChanged { files });
}

fn now() -> (chrono::DateTime<chrono::FixedOffset>, u64) {
    let n = chrono::Local::now();
    (n.fixed_offset(), n.timestamp_millis().max(0) as u64)
}

/// The display name, the same source `add_comment` uses for its author.
fn author_of(s: &crate::store::project_store::ProjectStore) -> String {
    s.settings().display_name
}

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
    state.sync.request(SyncReason::AfterSave);
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
    match &out {
        Saved::Conflict { copy, .. } | Saved::Recreated { copy } => {
            files.push(docs::file_name(&project, &copy.id));
        }
        Saved::Written(_) => {}
    }
    state.sync.request(SyncReason::AfterSave);
    emit_docs_changed(&app, files);
    Ok(out)
}

#[tauri::command]
pub async fn delete_doc(project: String, id: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    with_store(state.inner(), |s| {
        docs::archive(s.paths(), &project, Some(&id), chrono::Local::now().naive_local())
    })?;
    state.sync.request(SyncReason::AfterSave);
    emit_docs_changed(&app, vec![docs::file_name(&project, &id)]);
    Ok(())
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
