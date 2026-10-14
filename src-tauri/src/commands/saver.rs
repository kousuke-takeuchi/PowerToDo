//! Debounced background saving. Mutating commands only mark the in-memory store dirty and call
//! [`Saver::schedule`]; the write happens once the project has been quiet for [`DEBOUNCE`].
//!
//! The timing and retry logic is independent of Tauri: it talks to a [`SaveSink`], which the app
//! implements over `AppHandle` and the tests implement with counters.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::task::JoinHandle;

use crate::error::AppResult;

/// Quiet period before a scheduled save runs.
pub const DEBOUNCE: Duration = Duration::from_secs(1);
/// Pause between attempts after a failed write.
pub const RETRY_GAP: Duration = Duration::from_millis(300);
/// Retries after the first failed attempt (so up to 4 writes in total).
pub const RETRIES: u32 = 3;
/// Key used for the common workbook.
pub const COMMON_KEY: &str = "_common";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SaveState {
    Saving,
    Saved,
    Error,
}

/// Payload of the `save-status` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStatus {
    pub project: String,
    pub state: SaveState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// What the saver needs from the outside world.
pub trait SaveSink: Send + Sync + 'static {
    /// One write attempt for `key` (a project name or [`COMMON_KEY`]).
    fn save(&self, key: &str) -> AppResult<()>;
    /// Publishes a status change (the `save-status` event in the app).
    fn report(&self, status: SaveStatus);
}

pub struct Saver {
    debounce: Duration,
    retry_gap: Duration,
    pending: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl Default for Saver {
    fn default() -> Self {
        Self::new()
    }
}

impl Saver {
    pub fn new() -> Self {
        Self::with_debounce(DEBOUNCE)
    }

    pub fn with_debounce(debounce: Duration) -> Self {
        Saver {
            debounce,
            retry_gap: RETRY_GAP,
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Restarts the timer for `key`; the previous pending save for it is dropped. Must be called
    /// from inside a tokio runtime (Tauri's async commands run in one).
    pub fn schedule_with(&self, sink: Arc<dyn SaveSink>, key: String) {
        let debounce = self.debounce;
        let retry_gap = self.retry_gap;
        let task_key = key.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(debounce).await;
            // The outcome is already published as a `save-status` event.
            let _ = run(sink.as_ref(), &task_key, retry_gap).await;
        });
        let mut pending = self.lock_pending();
        pending.retain(|_, h| !h.is_finished());
        if let Some(previous) = pending.insert(key, handle) {
            previous.abort();
        }
    }

    /// Cancels the timer for `key` and saves right away (with the usual retries).
    pub async fn save_now(&self, sink: Arc<dyn SaveSink>, key: &str) -> AppResult<()> {
        if let Some(previous) = self.lock_pending().remove(key) {
            previous.abort();
        }
        run(sink.as_ref(), key, self.retry_gap).await
    }

    /// Drops the pending timer for `key` (nothing is written until something schedules it
    /// again). Safe to call from any thread.
    pub fn cancel(&self, key: &str) {
        if let Some(handle) = self.lock_pending().remove(key) {
            handle.abort();
        }
    }

    /// A save for `key` is waiting for its timer or running right now.
    pub fn is_pending(&self, key: &str) -> bool {
        self.lock_pending()
            .get(key)
            .is_some_and(|h| !h.is_finished())
    }

    /// Drops every pending timer (used before the store is replaced or flushed).
    pub fn cancel_all(&self) {
        for (_, handle) in self.lock_pending().drain() {
            handle.abort();
        }
    }

    fn lock_pending(&self) -> std::sync::MutexGuard<'_, HashMap<String, JoinHandle<()>>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Publishes `saving`, writes with up to [`RETRIES`] retries, then publishes `saved` or `error`.
/// A failed write leaves the project dirty in the store, so the next change retries it.
async fn run(sink: &dyn SaveSink, key: &str, retry_gap: Duration) -> AppResult<()> {
    let report = |state: SaveState, message: Option<String>| {
        sink.report(SaveStatus {
            project: key.to_string(),
            state,
            message,
        });
    };
    report(SaveState::Saving, None);
    let mut retries = 0;
    loop {
        match sink.save(key) {
            Ok(()) => {
                report(SaveState::Saved, None);
                return Ok(());
            }
            Err(_) if retries < RETRIES => {
                retries += 1;
                tokio::time::sleep(retry_gap).await;
            }
            Err(e) => {
                report(SaveState::Error, Some(e.to_string()));
                return Err(e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Fails the first `failures` attempts, then succeeds.
    struct FakeSink {
        calls: AtomicUsize,
        failures: usize,
        statuses: Mutex<Vec<SaveStatus>>,
    }

    impl FakeSink {
        fn new(failures: usize) -> Arc<Self> {
            Arc::new(FakeSink {
                calls: AtomicUsize::new(0),
                failures,
                statuses: Mutex::new(Vec::new()),
            })
        }
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
        fn states(&self) -> Vec<(String, SaveState)> {
            self.statuses
                .lock()
                .unwrap()
                .iter()
                .map(|s| (s.project.clone(), s.state))
                .collect()
        }
    }

    impl SaveSink for FakeSink {
        fn save(&self, _key: &str) -> AppResult<()> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst);
            if n < self.failures {
                Err(AppError::Locked {
                    message: "locked".into(),
                })
            } else {
                Ok(())
            }
        }
        fn report(&self, status: SaveStatus) {
            self.statuses.lock().unwrap().push(status);
        }
    }

    const MS: fn(u64) -> Duration = Duration::from_millis;

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn debounce_coalesces_saves() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(0);

        // Two requests inside the window: one write.
        saver.schedule_with(sink.clone(), "p".into());
        tokio::time::sleep(MS(500)).await;
        saver.schedule_with(sink.clone(), "p".into());
        tokio::time::sleep(MS(900)).await; // 400 ms after the second request: still waiting
        assert_eq!(sink.calls(), 0);
        tokio::time::sleep(MS(200)).await;
        assert_eq!(sink.calls(), 1);

        // A request after the window has passed: a second write.
        saver.schedule_with(sink.clone(), "p".into());
        tokio::time::sleep(MS(1100)).await;
        assert_eq!(sink.calls(), 2);
        assert_eq!(
            sink.states(),
            vec![
                ("p".into(), SaveState::Saving),
                ("p".into(), SaveState::Saved),
                ("p".into(), SaveState::Saving),
                ("p".into(), SaveState::Saved),
            ]
        );
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn cancel_drops_only_that_keys_pending_save() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(0);
        saver.schedule_with(sink.clone(), "a".into());
        saver.schedule_with(sink.clone(), "b".into());
        assert!(saver.is_pending("a") && saver.is_pending("b"));
        saver.cancel("a");
        assert!(!saver.is_pending("a"));
        assert!(saver.is_pending("b"));
        tokio::time::sleep(MS(1100)).await;
        assert_eq!(sink.calls(), 1);
        assert!(!saver.is_pending("b"), "a finished save is not pending");
        // Nothing comes back on its own.
        tokio::time::sleep(MS(5000)).await;
        assert_eq!(sink.calls(), 1);
        saver.cancel("never-scheduled");
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn different_projects_are_debounced_independently() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(0);
        saver.schedule_with(sink.clone(), "a".into());
        saver.schedule_with(sink.clone(), "b".into());
        tokio::time::sleep(MS(1100)).await;
        assert_eq!(sink.calls(), 2);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn retries_three_times_then_succeeds() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(3);
        saver.schedule_with(sink.clone(), "p".into());
        tokio::time::sleep(MS(3000)).await;
        assert_eq!(sink.calls(), 4);
        let states = sink.states();
        assert_eq!(states.last().unwrap().1, SaveState::Saved);
        assert!(states.iter().all(|(_, s)| *s != SaveState::Error));
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn gives_up_after_three_retries_and_reports_error() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(4);
        saver.schedule_with(sink.clone(), "p".into());
        tokio::time::sleep(MS(3000)).await;
        assert_eq!(sink.calls(), 4);
        let last = sink.statuses.lock().unwrap().last().cloned().unwrap();
        assert_eq!(last.state, SaveState::Error);
        assert_eq!(last.message.as_deref(), Some("locked"));
        // No further attempts on their own: the next change schedules a fresh save.
        tokio::time::sleep(MS(5000)).await;
        assert_eq!(sink.calls(), 4);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn save_now_skips_the_debounce_and_cancels_the_pending_timer() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(0);
        saver.schedule_with(sink.clone(), "p".into());
        saver.save_now(sink.clone(), "p").await.unwrap();
        assert_eq!(sink.calls(), 1);
        tokio::time::sleep(MS(2000)).await;
        assert_eq!(sink.calls(), 1);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn save_now_returns_the_error_after_retries() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(10);
        let err = saver.save_now(sink.clone(), "p").await.unwrap_err();
        assert!(matches!(err, AppError::Locked { .. }));
        assert_eq!(sink.calls(), 4);
        assert_eq!(sink.states().last().unwrap().1, SaveState::Error);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn cancel_all_drops_pending_saves() {
        let saver = Saver::with_debounce(MS(1000));
        let sink = FakeSink::new(0);
        saver.schedule_with(sink.clone(), "p".into());
        saver.cancel_all();
        tokio::time::sleep(MS(2000)).await;
        assert_eq!(sink.calls(), 0);
    }

    #[test]
    fn save_status_serializes_camel_case_and_omits_empty_message() {
        let s = SaveStatus {
            project: "p".into(),
            state: SaveState::Saving,
            message: None,
        };
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"project":"p","state":"saving"}"#
        );
        let e = SaveStatus {
            project: "p".into(),
            state: SaveState::Error,
            message: Some("x".into()),
        };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"project":"p","state":"error","message":"x"}"#
        );
    }
}

#[cfg(test)]
mod tauri_runtime_tests {
    /// Async Tauri commands run on `tauri::async_runtime`; `Saver` relies on `tokio::spawn`
    /// working there.
    #[test]
    fn tokio_spawn_works_inside_tauri_async_runtime() {
        let out = tauri::async_runtime::block_on(async {
            tauri::async_runtime::spawn(async { tokio::spawn(async { 7 }).await.unwrap() })
                .await
                .unwrap()
        });
        assert_eq!(out, 7);
    }
}
