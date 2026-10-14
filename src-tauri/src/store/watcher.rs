//! Watches the data folder with `notify` and hands over batches of changed paths after a quiet
//! period (仕様 §5.1: 500 ms, de-duplicated by path). Event kinds are not interpreted; the
//! receiver looks at the files' current state.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};

use crate::error::{AppError, AppResult};

/// How long the folder must stay quiet before a batch is delivered.
pub const QUIET: Duration = Duration::from_millis(500);
/// How often the debounce thread looks at its stop signal while idle.
const IDLE_POLL: Duration = Duration::from_millis(250);

/// Stops watching when dropped.
pub struct Watcher {
    _inner: RecommendedWatcher,
    stop: mpsc::Sender<()>,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

fn watch_error(e: impl std::fmt::Display) -> AppError {
    AppError::Io {
        message: format!("ファイル監視を開始できません: {e}"),
    }
}

/// Watches `dir` (not its subfolders). `on_paths` runs on a background thread with the
/// distinct paths that changed, once per quiet period.
pub fn start(dir: &Path, on_paths: impl Fn(Vec<PathBuf>) + Send + 'static) -> AppResult<Watcher> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let mut inner = RecommendedWatcher::new(tx, notify::Config::default()).map_err(watch_error)?;
    inner
        .watch(dir, RecursiveMode::NonRecursive)
        .map_err(watch_error)?;
    std::thread::Builder::new()
        .name("powertodo-watch".into())
        .spawn(move || debounce_loop(rx, stop_rx, on_paths))
        .map_err(watch_error)?;
    Ok(Watcher {
        _inner: inner,
        stop: stop_tx,
    })
}

fn debounce_loop(
    rx: mpsc::Receiver<notify::Result<notify::Event>>,
    stop: mpsc::Receiver<()>,
    on_paths: impl Fn(Vec<PathBuf>),
) {
    let mut pending: BTreeSet<PathBuf> = BTreeSet::new();
    let mut deadline: Option<Instant> = None;
    loop {
        if stop.try_recv().is_ok() {
            return;
        }
        let wait = deadline.map_or(IDLE_POLL, |d| {
            d.saturating_duration_since(Instant::now()).min(IDLE_POLL)
        });
        match rx.recv_timeout(wait) {
            Ok(Ok(ev)) => {
                pending.extend(ev.paths);
                deadline = Some(Instant::now() + QUIET);
            }
            Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Timeout) => {}
            // The `notify` watcher (the only sender) was dropped.
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        if let Some(d) = deadline
            && Instant::now() >= d
        {
            if !pending.is_empty() {
                on_paths(std::mem::take(&mut pending).into_iter().collect());
            }
            deadline = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    #[cfg_attr(not(target_os = "macos"), ignore = "timing depends on the OS watcher")]
    fn batches_are_delivered_after_quiet_period() {
        let dir = tempfile::tempdir().unwrap();
        let got: Arc<Mutex<Vec<Vec<PathBuf>>>> = Arc::default();
        let sink = got.clone();
        let _w = start(dir.path(), move |paths| sink.lock().unwrap().push(paths)).unwrap();
        std::thread::sleep(Duration::from_millis(200)); // let the OS watcher settle
        let file = dir.path().join("仕事.xlsx");
        std::fs::write(&file, b"a").unwrap();
        std::fs::write(&file, b"ab").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let batches = got.lock().unwrap().clone();
        assert_eq!(
            batches.len(),
            1,
            "two quick writes make one batch: {batches:?}"
        );
        assert!(batches[0].iter().any(|p| p.file_name() == file.file_name()));
    }
}
