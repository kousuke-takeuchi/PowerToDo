//! Attachment blobs (spec attachments §2, §8): store a file, hand it back, open it, show it in the
//! file manager, save a copy, and the usage the settings show. Which task a blob belongs to is in
//! the comment records (`comments.rs`).
//!
//! The page shows an image by reading its bytes (`read_attachment`, a raw IPC response) and making a
//! blob URL from them. The asset protocol is not used: it needs a static path scope, and the data
//! folder is chosen at run time (and may be anywhere, on iPhone inside the app's container).

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State};

use super::{AppState, with_store};
use crate::error::{AppError, AppResult};
use crate::platform;
use crate::store::attachments::{self, AttachmentInfo, Usage};
use crate::store::paths::Paths;

/// Payload of `attachments-changed`: blob file names (`<sha256>.<ext>`) a sync wrote here.
#[derive(Debug, Clone, Serialize)]
pub struct AttachmentsChanged {
    pub files: Vec<String>,
}

pub fn emit_attachments_changed(app: &AppHandle, files: Vec<String>) {
    let _ = app.emit("attachments-changed", AttachmentsChanged { files });
}

fn paths_of(state: &AppState) -> AppResult<Paths> {
    with_store(state, |s| Ok(s.paths().clone()))
}

fn header(req: &Request<'_>, key: &str) -> Option<String> {
    let raw = req.headers().get(key)?.to_str().ok()?;
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()
        .map(|c| c.into_owned())
}

/// Stores a file. The body is the raw bytes (no resizing here: the page shrinks images first);
/// the metadata rides in headers, `name` percent-encoded: `name`, `type`, and for images `w` / `h`.
/// Returns the description to put in `add_comment` / `edit_comment` / `attach_to_note`.
#[tauri::command]
pub async fn add_attachment(
    request: Request<'_>,
    state: State<'_, AppState>,
) -> AppResult<AttachmentInfo> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Invalid {
            message: "添付の中身が届きませんでした".into(),
        });
    };
    let name = header(&request, "name").unwrap_or_default();
    if name.trim().is_empty() {
        return Err(AppError::Invalid {
            message: "添付の名前がありません".into(),
        });
    }
    let mime = header(&request, "type").unwrap_or_default();
    let dim = |k: &str| header(&request, k).and_then(|v| v.parse::<u32>().ok());
    let wh = dim("w").zip(dim("h"));
    // Hashing and writing happen outside the store lock.
    let paths = paths_of(state.inner())?;
    attachments::add(&paths, bytes, &name, &mime, wh)
}

/// The bytes of a stored blob; `NotFound` while it has not arrived by sync.
#[tauri::command]
pub async fn read_attachment(
    hash: String,
    ext: String,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let paths = paths_of(state.inner())?;
    Ok(Response::new(attachments::read(&paths, &hash, &ext)?))
}

fn existing_path(state: &AppState, hash: &str, ext: &str) -> AppResult<std::path::PathBuf> {
    let p = attachments::path(&paths_of(state)?, hash, ext)?;
    if !p.is_file() {
        return Err(AppError::NotFound {
            message: "添付のファイルが見つかりません".into(),
        });
    }
    Ok(p)
}

/// Opens the blob with the default app (iPhone: refused, the page previews it itself).
#[tauri::command]
pub async fn open_attachment(
    hash: String,
    ext: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    platform::open_file(&app, &existing_path(state.inner(), &hash, &ext)?)
}

/// Shows the blob in Finder / Explorer (iPhone: refused).
#[tauri::command]
pub async fn reveal_attachment(
    hash: String,
    ext: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    platform::reveal_file(&app, &existing_path(state.inner(), &hash, &ext)?)
}

/// Copies the blob to `dest`, a path the user picked with the dialog's save panel.
#[tauri::command]
pub async fn save_attachment_as(
    hash: String,
    ext: String,
    dest: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let src = existing_path(state.inner(), &hash, &ext)?;
    std::fs::copy(src, dest)?;
    Ok(())
}

/// Count and total size of the blobs on this device (settings, spec §8).
#[tauri::command]
pub async fn attachment_usage(state: State<'_, AppState>) -> AppResult<Usage> {
    let paths = paths_of(state.inner())?;
    attachments::usage(&paths)
}
