//! Manages the `powertodo-tailnet` sidecar (Go + tsnet) and its JSON line protocol.
//!
//! The sidecar talks over stdin / stdout, one JSON object per line (spec section 4.1). One reader
//! thread per child parses its output; replies to commands are routed by `id`, status changes go
//! to the `on_status` callback. If the child dies unexpectedly it is restarted after a pause, up
//! to [`MAX_RESTARTS`] times in a row.

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize, Serializer};

/// Pause before a crashed sidecar is started again.
const RESTART_DELAY: Duration = Duration::from_secs(5);
/// Unexpected exits tolerated in a row; the next one makes the state `Failed`.
const MAX_RESTARTS: u32 = 3;
/// How long a child gets to exit after its stdin is closed before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(3);

/// Request timeouts (the sidecar itself allows 90 s for a logout).
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);
pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(30);
pub const LOGOUT_TIMEOUT: Duration = Duration::from_secs(95);

/// How long a `failed` status waits to see whether the sidecar exits right after it.
const FAILED_GRACE: Duration = Duration::from_millis(500);

const FAILED_REASON: &str = "Tailscale を起動できません";

// ---------------------------------------------------------------------------------------------
// State

/// What the sidecar's Tailscale node is doing, as the UI sees it.
#[derive(Debug, Clone, PartialEq)]
pub enum TailnetState {
    Stopped,
    NeedsLogin { url: Option<String> },
    NeedsApproval,
    Starting { since: Instant },
    Running { name: String, ip: String },
    Failed { reason: String },
}

/// The serialized form of [`TailnetState`]: `{state, name?, ip?, loginUrl?, error?, startedSecs?}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailnetStatusView {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Seconds spent in `starting` (the UI shows a hint after 30).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_secs: Option<u64>,
}

impl TailnetStatusView {
    fn bare(state: &'static str) -> Self {
        Self {
            state,
            name: None,
            ip: None,
            login_url: None,
            error: None,
            started_secs: None,
        }
    }
}

impl TailnetState {
    pub fn view(&self) -> TailnetStatusView {
        match self {
            Self::Stopped => TailnetStatusView::bare("stopped"),
            Self::NeedsLogin { url } => TailnetStatusView {
                login_url: url.clone(),
                ..TailnetStatusView::bare("needs_login")
            },
            Self::NeedsApproval => TailnetStatusView::bare("needs_approval"),
            Self::Starting { since } => TailnetStatusView {
                started_secs: Some(since.elapsed().as_secs()),
                ..TailnetStatusView::bare("starting")
            },
            Self::Running { name, ip } => TailnetStatusView {
                name: Some(name.clone()),
                ip: Some(ip.clone()),
                ..TailnetStatusView::bare("running")
            },
            Self::Failed { reason } => TailnetStatusView {
                error: Some(reason.clone()),
                ..TailnetStatusView::bare("failed")
            },
        }
    }

    /// Builds the state for a `status` message. `None` for a state this app does not know.
    fn from_status(
        state: &str,
        name: Option<String>,
        ip: Option<String>,
        login_url: Option<String>,
        error: Option<String>,
        previous: &TailnetState,
    ) -> Option<Self> {
        Some(match state {
            "stopped" => Self::Stopped,
            "needs_login" => Self::NeedsLogin {
                url: login_url.filter(|u| !u.is_empty()),
            },
            "needs_approval" => Self::NeedsApproval,
            // Keep counting from the first `starting` so the 30 s hint is not reset by repeats.
            "starting" => match previous {
                Self::Starting { since } => Self::Starting { since: *since },
                _ => Self::Starting {
                    since: Instant::now(),
                },
            },
            "running" => Self::Running {
                name: name.unwrap_or_default(),
                ip: ip.unwrap_or_default(),
            },
            "failed" => Self::Failed {
                reason: error
                    .filter(|e| !e.is_empty())
                    .unwrap_or_else(|| FAILED_REASON.to_string()),
            },
            _ => return None,
        })
    }
}

impl Serialize for TailnetState {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.view().serialize(serializer)
    }
}

// ---------------------------------------------------------------------------------------------
// Protocol

/// A message from the sidecar.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Message {
    Ready {
        proxy: String,
    },
    Status {
        state: String,
        name: Option<String>,
        ip: Option<String>,
        #[serde(rename = "loginUrl")]
        login_url: Option<String>,
        error: Option<String>,
    },
    Resolved {
        id: Option<u64>,
        ip: Option<String>,
        error: Option<String>,
    },
    Done {
        id: Option<u64>,
        error: Option<String>,
    },
}

/// Parses one line of sidecar output. Anything that is not a known message gives `None`.
pub fn parse_line(line: &str) -> Option<Message> {
    serde_json::from_str(line.trim()).ok()
}

/// The answer to a command with an id.
#[derive(Debug)]
enum Reply {
    Resolved {
        ip: Option<String>,
        error: Option<String>,
    },
    Done {
        error: Option<String>,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum TailnetError {
    #[error("failed to start the Tailscale sidecar: {0}")]
    Spawn(#[from] io::Error),
    #[error("the Tailscale sidecar is not running")]
    NotRunning,
    #[error("the Tailscale sidecar did not answer in time")]
    Timeout,
    #[error("{0}")]
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ResolveError {
    #[error("not in the tailnet")]
    NotInTailnet,
    #[error("Tailscale is not running")]
    NotRunning,
    #[error("timed out")]
    Timeout,
    #[error("{0}")]
    Failed(String),
}

// ---------------------------------------------------------------------------------------------
// Paths

/// Picks the sidecar binary. Bundled apps have it next to the executable (Tauri strips the
/// triple suffix of `externalBin` files); a development tree has it in `binaries/` with the
/// suffix. The dev path is returned even if it does not exist (starting then fails with a
/// clear error).
pub fn resolve_sidecar_path(
    exe_dir: Option<&Path>,
    manifest_dir: &Path,
    triple: &str,
    windows: bool,
    exists: impl Fn(&Path) -> bool,
) -> PathBuf {
    let ext = if windows { ".exe" } else { "" };
    if let Some(dir) = exe_dir {
        let bundled = dir.join(format!("powertodo-tailnet{ext}"));
        if exists(&bundled) {
            return bundled;
        }
    }
    manifest_dir
        .join("binaries")
        .join(format!("powertodo-tailnet-{triple}{ext}"))
}

pub fn sidecar_path() -> PathBuf {
    let exe = std::env::current_exe().ok();
    resolve_sidecar_path(
        exe.as_deref().and_then(Path::parent),
        Path::new(env!("CARGO_MANIFEST_DIR")),
        env!("POWERTODO_TARGET_TRIPLE"),
        cfg!(windows),
        Path::exists,
    )
}

/// The node name this OS registers in the tailnet.
pub fn default_hostname() -> &'static str {
    if cfg!(target_os = "macos") {
        "powertodo-mac"
    } else if cfg!(windows) {
        "powertodo-win"
    } else {
        "powertodo-linux"
    }
}

/// The Tailscale state folder inside the app data directory.
pub fn state_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("tailscale")
}

fn create_state_dir(dir: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(dir)
    }
}

// ---------------------------------------------------------------------------------------------
// Process management

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
}

struct Inner {
    binary: PathBuf,
    dir: PathBuf,
    hostname: String,
    restart_delay: Duration,
    on_status: Mutex<Box<dyn Fn(TailnetStatusView) + Send>>,

    state: Mutex<TailnetState>,
    proxy: Mutex<Option<String>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Reply>>>,
    next_id: AtomicU64,
    child: Mutex<Option<Running>>,
    /// Serializes start / stop / reset / restart. Lock order: `lifecycle`, then `child`, then
    /// the small state locks. The `on_status` callback is never called with any of these held.
    lifecycle: Mutex<()>,
    /// Bumped for every spawned child and every intentional stop. A reader thread whose number
    /// is no longer current belongs to a child that was stopped on purpose.
    generation: AtomicU64,
    restarts: AtomicU32,
    /// Error text of a `failed` status from a sidecar that was exiting; used as the reason if
    /// the restarts run out. Cleared when a child is spawned.
    last_failure: Mutex<Option<String>>,
    shutdown: Mutex<bool>,
    shutdown_cv: Condvar,
}

impl Inner {
    fn emit(&self, state: &TailnetState) {
        let view = state.view();
        (lock(&self.on_status))(view);
    }

    fn is_stale(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) != generation || *lock(&self.shutdown)
    }

    /// Sleeps for `d`; returns true if the tailnet was shut down meanwhile.
    fn wait_shutdown(&self, d: Duration) -> bool {
        let guard = lock(&self.shutdown);
        let (guard, _) = self
            .shutdown_cv
            .wait_timeout_while(guard, d, |down| !*down)
            .unwrap_or_else(|e| e.into_inner());
        *guard
    }

    /// Moves to `Starting` unless already there. Returns the new state if it changed.
    fn enter_starting(&self) -> Option<TailnetState> {
        let mut state = lock(&self.state);
        if matches!(*state, TailnetState::Starting { .. }) {
            return None;
        }
        *state = TailnetState::Starting {
            since: Instant::now(),
        };
        Some(state.clone())
    }

    /// True if the child has exited, or does within a short grace period. A `failed` status is
    /// usually the sidecar's last words; whether it is final is told by the process ending.
    fn child_exits_soon(&self, generation: u64) -> bool {
        let deadline = Instant::now() + FAILED_GRACE;
        loop {
            if self.is_stale(generation) {
                return false;
            }
            match lock(&self.child).as_mut() {
                None => return true,
                Some(running) => {
                    if !matches!(running.child.try_wait(), Ok(None)) {
                        return true;
                    }
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    /// Drops every waiting request (their receivers see a disconnect).
    fn fail_pending(&self) {
        lock(&self.pending).clear();
    }

    fn handle_message(&self, msg: Message) {
        match msg {
            Message::Ready { proxy } => *lock(&self.proxy) = Some(proxy),
            Message::Status {
                state,
                name,
                ip,
                login_url,
                error,
            } => {
                let new = {
                    let mut current = lock(&self.state);
                    let Some(new) =
                        TailnetState::from_status(&state, name, ip, login_url, error, &current)
                    else {
                        return;
                    };
                    *current = new.clone();
                    new
                };
                if matches!(new, TailnetState::Running { .. }) {
                    self.restarts.store(0, Ordering::SeqCst);
                }
                self.emit(&new);
            }
            Message::Resolved {
                id: Some(id),
                ip,
                error,
            } => self.reply(id, Reply::Resolved { ip, error }),
            Message::Done {
                id: Some(id),
                error,
            } => self.reply(id, Reply::Done { error }),
            Message::Resolved { id: None, .. } | Message::Done { id: None, .. } => {}
        }
    }

    fn reply(&self, id: u64, reply: Reply) {
        let tx = lock(&self.pending).remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(reply);
        }
    }
}

/// Waits for `child` to exit (up to `grace`), then kills it.
fn terminate(child: &mut Child, grace: Duration) {
    let deadline = Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Starts the child and its reader thread. The caller holds `lifecycle`.
fn spawn_child(inner: &Arc<Inner>) -> Result<(), TailnetError> {
    create_state_dir(&inner.dir)?;
    let mut cmd = Command::new(&inner.binary);
    cmd.arg("--dir")
        .arg(&inner.dir)
        .arg("--hostname")
        .arg(&inner.hostname)
        .env("TS_NO_LOGS_NO_SUPPORT", "true")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            *lock(&inner.last_failure) = None;
            return Err(e.into());
        }
    };
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().expect("stdout is piped");

    let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *lock(&inner.proxy) = None;
    *lock(&inner.last_failure) = None; // after the bump: see `reader_loop`
    *lock(&inner.child) = Some(Running { child, stdin });

    let reader_inner = Arc::clone(inner);
    let spawned = thread::Builder::new()
        .name("tailnet-reader".into())
        .spawn(move || reader_loop(reader_inner, stdout, generation));
    if let Err(e) = spawned {
        if let Some(mut running) = lock(&inner.child).take() {
            drop(running.stdin.take());
            terminate(&mut running.child, Duration::ZERO);
        }
        return Err(e.into());
    }
    Ok(())
}

/// Stops the current child on purpose. The caller holds `lifecycle`.
fn stop_child(inner: &Inner) {
    inner.generation.fetch_add(1, Ordering::SeqCst);
    let running = lock(&inner.child).take();
    *lock(&inner.proxy) = None;
    inner.fail_pending();
    if let Some(mut running) = running {
        drop(running.stdin.take()); // EOF on stdin makes the sidecar exit
        terminate(&mut running.child, STOP_GRACE);
    }
}

fn reader_loop(inner: Arc<Inner>, stdout: ChildStdout, generation: u64) {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        if inner.is_stale(generation) {
            return;
        }
        if let Some(msg) = parse_line(&String::from_utf8_lossy(&buf)) {
            // The sidecar says `failed` and exits when it cannot start. Do not show that as a
            // state (and then flip back to starting); remember the text and let the restart
            // logic decide.
            if let Message::Status { state, error, .. } = &msg
                && state == "failed"
            {
                let exits = inner.child_exits_soon(generation);
                // Stopped on purpose while we waited: this child's words no longer count.
                // (Checked under the `last_failure` lock; `spawn_child` clears it after
                // bumping the generation, so a stale reader cannot leave text behind.)
                let mut held = lock(&inner.last_failure);
                if inner.is_stale(generation) {
                    return;
                }
                if exits {
                    *held = error.clone().filter(|e| !e.is_empty());
                    continue;
                }
            }
            inner.handle_message(msg);
        }
    }
    on_exit(&inner, generation);
}

/// The child's output ended. If that was not asked for, restart it after a pause, or give up.
fn on_exit(inner: &Arc<Inner>, mut generation: u64) {
    loop {
        let announce = {
            let _life = lock(&inner.lifecycle);
            if inner.is_stale(generation) {
                return;
            }
            let running = lock(&inner.child).take();
            *lock(&inner.proxy) = None;
            inner.fail_pending();
            if let Some(mut running) = running {
                drop(running.stdin.take());
                terminate(&mut running.child, STOP_GRACE);
            }
            if inner.restarts.fetch_add(1, Ordering::SeqCst) >= MAX_RESTARTS {
                let failed = TailnetState::Failed {
                    reason: lock(&inner.last_failure)
                        .take()
                        .unwrap_or_else(|| FAILED_REASON.to_string()),
                };
                *lock(&inner.state) = failed.clone();
                drop(_life);
                inner.emit(&failed);
                return;
            }
            inner.enter_starting()
        };
        if let Some(state) = announce {
            inner.emit(&state);
        }
        if inner.wait_shutdown(inner.restart_delay) {
            return;
        }
        let _life = lock(&inner.lifecycle);
        if inner.is_stale(generation) {
            return;
        }
        if spawn_child(inner).is_ok() {
            return;
        }
        // Could not even start: counts as another failed run. A failed spawn may have bumped
        // the generation (we hold `lifecycle`, so nobody else did).
        generation = inner.generation.load(Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------------------------
// Public handle

pub struct Tailnet {
    inner: Arc<Inner>,
}

impl Tailnet {
    /// Starts the sidecar. `dir` is the Tailscale state folder (created with mode 0700 on Unix).
    /// `on_status` is called from a background thread whenever the state changes. It must not
    /// call back into this `Tailnet` and should return quickly: it runs on the reader thread, so
    /// a slow or re-entrant callback blocks the sidecar's output and can deadlock `reset()` /
    /// `Drop`.
    pub fn start(
        binary: PathBuf,
        dir: PathBuf,
        hostname: &str,
        on_status: impl Fn(TailnetStatusView) + Send + 'static,
    ) -> Result<Tailnet, TailnetError> {
        Self::start_with_delay(binary, dir, hostname, RESTART_DELAY, on_status)
    }

    fn start_with_delay(
        binary: PathBuf,
        dir: PathBuf,
        hostname: &str,
        restart_delay: Duration,
        on_status: impl Fn(TailnetStatusView) + Send + 'static,
    ) -> Result<Tailnet, TailnetError> {
        let inner = Arc::new(Inner {
            binary,
            dir,
            hostname: hostname.to_string(),
            restart_delay,
            on_status: Mutex::new(Box::new(on_status)),
            state: Mutex::new(TailnetState::Starting {
                since: Instant::now(),
            }),
            proxy: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            child: Mutex::new(None),
            lifecycle: Mutex::new(()),
            generation: AtomicU64::new(0),
            restarts: AtomicU32::new(0),
            last_failure: Mutex::new(None),
            shutdown: Mutex::new(false),
            shutdown_cv: Condvar::new(),
        });
        {
            let _life = lock(&inner.lifecycle);
            spawn_child(&inner)?;
        }
        Ok(Tailnet { inner })
    }

    /// The SOCKS5 proxy (`socks5h://user:pass@127.0.0.1:port`) once the sidecar said `ready`.
    pub fn proxy_url(&self) -> Option<String> {
        lock(&self.inner.proxy).clone()
    }

    pub fn state(&self) -> TailnetState {
        lock(&self.inner.state).clone()
    }

    /// Starts the interactive login. The URL arrives as a `needs_login` status.
    pub fn login(&self) -> Result<(), TailnetError> {
        self.command_done(
            |id| serde_json::json!({"cmd": "login", "id": id}),
            LOGIN_TIMEOUT,
        )
    }

    pub fn logout(&self) -> Result<(), TailnetError> {
        self.command_done(
            |id| serde_json::json!({"cmd": "logout", "id": id}),
            LOGOUT_TIMEOUT,
        )
    }

    /// Looks `host` up among the tailnet's peers (MagicDNS name, FQDN, host name or 100.x).
    pub fn resolve(&self, host: &str, timeout: Duration) -> Result<IpAddr, ResolveError> {
        let reply = self
            .request(
                |id| serde_json::json!({"cmd": "resolve", "id": id, "host": host}),
                timeout,
            )
            .map_err(|e| match e {
                TailnetError::Timeout => ResolveError::Timeout,
                TailnetError::NotRunning => ResolveError::NotRunning,
                other => ResolveError::Failed(other.to_string()),
            })?;
        match reply {
            Reply::Resolved { error: Some(e), .. } | Reply::Done { error: Some(e) } => {
                Err(match e.as_str() {
                    "not_in_tailnet" => ResolveError::NotInTailnet,
                    "not_running" => ResolveError::NotRunning,
                    _ => ResolveError::Failed(e),
                })
            }
            Reply::Resolved {
                ip: Some(ip),
                error: None,
            } => ip
                .parse()
                .map_err(|_| ResolveError::Failed(format!("bad address: {ip}"))),
            _ => Err(ResolveError::Failed("empty reply".into())),
        }
    }

    /// Stops the sidecar, deletes the Tailscale state folder and starts it again, so the node
    /// comes back needing a login.
    pub fn reset(&self) -> Result<(), TailnetError> {
        let inner = &self.inner;
        let announce = {
            let _life = lock(&inner.lifecycle);
            if *lock(&inner.shutdown) {
                return Err(TailnetError::NotRunning);
            }
            stop_child(inner);
            if let Err(e) = std::fs::remove_dir_all(&inner.dir)
                && e.kind() != io::ErrorKind::NotFound
            {
                let failed = TailnetState::Failed {
                    reason: format!("Tailscale の状態を消せません: {e}"),
                };
                *lock(&inner.state) = failed.clone();
                drop(_life);
                inner.emit(&failed);
                return Err(TailnetError::Failed(format!(
                    "could not remove the Tailscale state folder: {e}"
                )));
            }
            inner.restarts.store(0, Ordering::SeqCst);
            let starting = TailnetState::Starting {
                since: Instant::now(),
            };
            *lock(&inner.state) = starting.clone();
            if let Err(e) = spawn_child(inner) {
                let failed = TailnetState::Failed {
                    reason: FAILED_REASON.to_string(),
                };
                *lock(&inner.state) = failed.clone();
                drop(_life);
                inner.emit(&failed);
                return Err(e);
            }
            starting
        };
        inner.emit(&announce);
        Ok(())
    }

    fn command_done(
        &self,
        build: impl FnOnce(u64) -> serde_json::Value,
        timeout: Duration,
    ) -> Result<(), TailnetError> {
        match self.request(build, timeout)? {
            Reply::Done { error: None } => Ok(()),
            Reply::Done { error: Some(e) } | Reply::Resolved { error: Some(e), .. } => {
                Err(TailnetError::Failed(e))
            }
            Reply::Resolved { .. } => Err(TailnetError::Failed("unexpected reply".into())),
        }
    }

    fn request(
        &self,
        build: impl FnOnce(u64) -> serde_json::Value,
        timeout: Duration,
    ) -> Result<Reply, TailnetError> {
        let inner = &self.inner;
        let id = inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        lock(&inner.pending).insert(id, tx);
        let mut line = build(id).to_string();
        line.push('\n');
        let written = {
            let mut child = lock(&inner.child);
            match child.as_mut().and_then(|r| r.stdin.as_mut()) {
                Some(stdin) => stdin
                    .write_all(line.as_bytes())
                    .and_then(|()| stdin.flush())
                    .is_ok(),
                None => false,
            }
        };
        if !written {
            lock(&inner.pending).remove(&id);
            return Err(TailnetError::NotRunning);
        }
        match rx.recv_timeout(timeout) {
            Ok(reply) => Ok(reply),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                lock(&inner.pending).remove(&id);
                Err(TailnetError::Timeout)
            }
            // The child went away (or was stopped) while we waited.
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(TailnetError::NotRunning),
        }
    }
}

impl Drop for Tailnet {
    fn drop(&mut self) {
        let inner = &self.inner;
        *lock(&inner.shutdown) = true;
        inner.shutdown_cv.notify_all();
        let _life = lock(&inner.lifecycle);
        stop_child(inner);
    }
}

// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn msg(line: &str) -> Message {
        parse_line(line).expect("parses")
    }

    #[test]
    fn parses_ready() {
        assert_eq!(
            msg(r#"{"type":"ready","proxy":"socks5h://tsnet:abc@127.0.0.1:5555"}"#),
            Message::Ready {
                proxy: "socks5h://tsnet:abc@127.0.0.1:5555".into()
            }
        );
    }

    #[test]
    fn parses_every_status_state() {
        for state in [
            "stopped",
            "needs_login",
            "needs_approval",
            "starting",
            "running",
            "failed",
        ] {
            let line = format!(r#"{{"type":"status","state":"{state}"}}"#);
            assert_eq!(
                msg(&line),
                Message::Status {
                    state: state.into(),
                    name: None,
                    ip: None,
                    login_url: None,
                    error: None
                }
            );
        }
    }

    #[test]
    fn parses_status_fields() {
        assert_eq!(
            msg(
                r#"{"type":"status","state":"running","name":"powertodo-mac.tail.ts.net","ip":"100.64.0.1"}"#
            ),
            Message::Status {
                state: "running".into(),
                name: Some("powertodo-mac.tail.ts.net".into()),
                ip: Some("100.64.0.1".into()),
                login_url: None,
                error: None
            }
        );
        assert_eq!(
            msg(
                r#"{"type":"status","state":"needs_login","loginUrl":"https://login.tailscale.com/a/1"}"#
            ),
            Message::Status {
                state: "needs_login".into(),
                name: None,
                ip: None,
                login_url: Some("https://login.tailscale.com/a/1".into()),
                error: None
            }
        );
        assert_eq!(
            msg(r#"{"type":"status","state":"failed","error":"start: boom"}"#),
            Message::Status {
                state: "failed".into(),
                name: None,
                ip: None,
                login_url: None,
                error: Some("start: boom".into())
            }
        );
    }

    #[test]
    fn parses_resolved_ok_and_error() {
        assert_eq!(
            msg(r#"{"type":"resolved","id":3,"ip":"100.1.2.3"}"#),
            Message::Resolved {
                id: Some(3),
                ip: Some("100.1.2.3".into()),
                error: None
            }
        );
        assert_eq!(
            msg(r#"{"type":"resolved","id":4,"error":"not_in_tailnet"}"#),
            Message::Resolved {
                id: Some(4),
                ip: None,
                error: Some("not_in_tailnet".into())
            }
        );
        assert_eq!(
            msg(r#"{"type":"resolved","ip":"100.1.2.3"}"#),
            Message::Resolved {
                id: None,
                ip: Some("100.1.2.3".into()),
                error: None
            }
        );
    }

    #[test]
    fn parses_done() {
        assert_eq!(
            msg(r#"{"type":"done","id":2}"#),
            Message::Done {
                id: Some(2),
                error: None
            }
        );
        assert_eq!(
            msg(r#"{"type":"done","id":2,"error":"unknown_command"}"#),
            Message::Done {
                id: Some(2),
                error: Some("unknown_command".into())
            }
        );
    }

    #[test]
    fn broken_lines_are_none() {
        for line in [
            "",
            "   ",
            "not json",
            "{",
            "[]",
            "null",
            r#"{"state":"running"}"#,
            r#"{"type":"nope"}"#,
            r#"{"type":"ready"}"#,
            r#"{"type":"status"}"#,
            r#"{"type":"done","id":"x"}"#,
        ] {
            assert_eq!(parse_line(line), None, "{line:?}");
        }
    }

    #[test]
    fn tolerates_surrounding_whitespace_and_unknown_fields() {
        assert!(matches!(
            parse_line("  {\"type\":\"done\",\"id\":1,\"extra\":true}\r\n"),
            Some(Message::Done { id: Some(1), .. })
        ));
    }

    fn to_json(state: &TailnetState) -> serde_json::Value {
        serde_json::to_value(state).unwrap()
    }

    #[test]
    fn state_json_shapes() {
        assert_eq!(to_json(&TailnetState::Stopped), json!({"state": "stopped"}));
        assert_eq!(
            to_json(&TailnetState::NeedsLogin { url: None }),
            json!({"state": "needs_login"})
        );
        assert_eq!(
            to_json(&TailnetState::NeedsLogin {
                url: Some("https://x/y".into())
            }),
            json!({"state": "needs_login", "loginUrl": "https://x/y"})
        );
        assert_eq!(
            to_json(&TailnetState::NeedsApproval),
            json!({"state": "needs_approval"})
        );
        assert_eq!(
            to_json(&TailnetState::Starting {
                since: Instant::now()
            }),
            json!({"state": "starting", "startedSecs": 0})
        );
        assert_eq!(
            to_json(&TailnetState::Running {
                name: "n.ts.net".into(),
                ip: "100.1.1.1".into()
            }),
            json!({"state": "running", "name": "n.ts.net", "ip": "100.1.1.1"})
        );
        assert_eq!(
            to_json(&TailnetState::Failed {
                reason: "boom".into()
            }),
            json!({"state": "failed", "error": "boom"})
        );
    }

    #[test]
    fn starting_reports_elapsed_seconds() {
        let since = Instant::now() - Duration::from_secs(31);
        assert_eq!(
            TailnetState::Starting { since }.view().started_secs,
            Some(31)
        );
    }

    #[test]
    fn repeated_starting_keeps_the_first_start_time() {
        let since = Instant::now() - Duration::from_secs(20);
        let prev = TailnetState::Starting { since };
        let next = TailnetState::from_status("starting", None, None, None, None, &prev);
        assert_eq!(next, Some(TailnetState::Starting { since }));
    }

    #[test]
    fn unknown_status_state_is_ignored() {
        let prev = TailnetState::Stopped;
        assert_eq!(
            TailnetState::from_status("dancing", None, None, None, None, &prev),
            None
        );
    }

    #[test]
    fn sidecar_path_prefers_the_bundled_name() {
        let exe_dir = Path::new("/app/bin");
        let manifest = Path::new("/src/src-tauri");
        let p = resolve_sidecar_path(
            Some(exe_dir),
            manifest,
            "x86_64-pc-windows-msvc",
            true,
            |p| p == Path::new("/app/bin/powertodo-tailnet.exe"),
        );
        assert_eq!(p, Path::new("/app/bin/powertodo-tailnet.exe"));
        let p = resolve_sidecar_path(
            Some(exe_dir),
            manifest,
            "aarch64-apple-darwin",
            false,
            |p| p == Path::new("/app/bin/powertodo-tailnet"),
        );
        assert_eq!(p, Path::new("/app/bin/powertodo-tailnet"));
    }

    #[test]
    fn sidecar_path_falls_back_to_the_dev_binary() {
        let exe_dir = Path::new("/src/target/debug/deps");
        let manifest = Path::new("/src/src-tauri");
        let p = resolve_sidecar_path(
            Some(exe_dir),
            manifest,
            "aarch64-apple-darwin",
            false,
            |_| false,
        );
        assert_eq!(
            p,
            Path::new("/src/src-tauri/binaries/powertodo-tailnet-aarch64-apple-darwin")
        );
        let p = resolve_sidecar_path(None, manifest, "x86_64-pc-windows-msvc", true, |_| true);
        assert_eq!(
            p,
            Path::new("/src/src-tauri/binaries/powertodo-tailnet-x86_64-pc-windows-msvc.exe")
        );
    }

    #[test]
    fn sidecar_path_is_never_empty() {
        let p = sidecar_path();
        let name = p.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("powertodo-tailnet"), "{name}");
    }

    #[test]
    fn hostname_and_state_dir() {
        assert!(default_hostname().starts_with("powertodo-"));
        assert_eq!(state_dir(Path::new("/data")), Path::new("/data/tailscale"));
    }

    #[cfg(unix)]
    #[test]
    fn state_dir_is_created_private() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("a").join("tailscale");
        create_state_dir(&dir).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
    }

    // -- fake sidecars (shell scripts) -------------------------------------------------------

    #[cfg(unix)]
    mod fake {
        use super::super::*;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::mpsc::{Receiver, channel};

        /// Fake-script tests run one at a time (avoids "text file busy" on exec).
        static SERIAL: Mutex<()> = Mutex::new(());

        fn script(dir: &Path, body: &str) -> PathBuf {
            let path = dir.join("fake-sidecar.sh");
            // $2 is the state dir (args are `--dir <dir> --hostname <h>`).
            std::fs::write(
                &path,
                format!("#!/bin/sh\necho x >> \"$2/spawns\"\n{body}\n"),
            )
            .unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        fn spawns(state_dir: &Path) -> usize {
            std::fs::read_to_string(state_dir.join("spawns"))
                .map(|s| s.lines().count())
                .unwrap_or(0)
        }

        fn start(
            body: &str,
            delay: Duration,
        ) -> (
            tempfile::TempDir,
            PathBuf,
            Tailnet,
            Receiver<TailnetStatusView>,
        ) {
            start_at(body, delay, "state")
        }

        /// Like `start`, with the state folder at `tmp/<rel>`.
        fn start_at(
            body: &str,
            delay: Duration,
            rel: &str,
        ) -> (
            tempfile::TempDir,
            PathBuf,
            Tailnet,
            Receiver<TailnetStatusView>,
        ) {
            let tmp = tempfile::tempdir().unwrap();
            let bin = script(tmp.path(), body);
            let dir = tmp.path().join(rel);
            let (tx, rx) = channel();
            let t =
                Tailnet::start_with_delay(bin, dir.clone(), "powertodo-test", delay, move |v| {
                    let _ = tx.send(v);
                })
                .unwrap();
            (tmp, dir, t, rx)
        }

        fn wait_for(what: &str, mut cond: impl FnMut() -> bool) {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !cond() {
                assert!(Instant::now() < deadline, "timed out waiting for {what}");
                thread::sleep(Duration::from_millis(10));
            }
        }

        const READY: &str = r#"echo '{"type":"ready","proxy":"socks5h://u:p@127.0.0.1:1"}'"#;
        const RUNNING: &str =
            r#"echo '{"type":"status","state":"running","name":"me.ts.net","ip":"100.1.1.1"}'"#;
        const WAIT_EOF: &str = "while read line; do :; done";

        #[test]
        fn ready_status_and_resolve_round_trip() {
            let _g = lock(&SERIAL);
            let body = format!(
                "{READY}\n{RUNNING}\nread line\necho '{{\"type\":\"resolved\",\"id\":1,\"ip\":\"100.2.2.2\"}}'\n{WAIT_EOF}"
            );
            let (_tmp, _dir, t, rx) = start(&body, Duration::from_millis(10));
            let view = rx.recv_timeout(Duration::from_secs(10)).unwrap();
            assert_eq!(view.state, "running");
            assert_eq!(view.ip.as_deref(), Some("100.1.1.1"));
            assert_eq!(t.proxy_url().as_deref(), Some("socks5h://u:p@127.0.0.1:1"));
            assert_eq!(
                t.state(),
                TailnetState::Running {
                    name: "me.ts.net".into(),
                    ip: "100.1.1.1".into()
                }
            );
            assert_eq!(
                t.resolve("nas", Duration::from_secs(5)),
                Ok("100.2.2.2".parse().unwrap())
            );
        }

        #[test]
        fn resolve_errors_map_to_variants() {
            let _g = lock(&SERIAL);
            for (reply, expected) in [
                (
                    r#"{"type":"resolved","id":1,"error":"not_in_tailnet"}"#,
                    ResolveError::NotInTailnet,
                ),
                (
                    r#"{"type":"resolved","id":1,"error":"not_running"}"#,
                    ResolveError::NotRunning,
                ),
                (
                    r#"{"type":"done","id":1,"error":"unknown_command"}"#,
                    ResolveError::Failed("unknown_command".into()),
                ),
            ] {
                let body = format!("{READY}\nread line\necho '{reply}'\n{WAIT_EOF}");
                let (_tmp, _dir, t, _rx) = start(&body, Duration::from_millis(10));
                assert_eq!(
                    t.resolve("nas", Duration::from_secs(5)),
                    Err(expected),
                    "{reply}"
                );
            }
        }

        #[test]
        fn resolve_times_out_and_forgets_the_request() {
            let _g = lock(&SERIAL);
            let body = format!("{READY}\n{WAIT_EOF}");
            let (_tmp, _dir, t, _rx) = start(&body, Duration::from_millis(10));
            assert_eq!(
                t.resolve("nas", Duration::from_millis(200)),
                Err(ResolveError::Timeout)
            );
            assert!(lock(&t.inner.pending).is_empty());
        }

        #[test]
        fn login_and_logout_wait_for_done() {
            let _g = lock(&SERIAL);
            let body = format!(
                "{READY}\nread line\necho '{{\"type\":\"done\",\"id\":1}}'\nread line\necho '{{\"type\":\"done\",\"id\":2,\"error\":\"nope\"}}'\n{WAIT_EOF}"
            );
            let (_tmp, _dir, t, _rx) = start(&body, Duration::from_millis(10));
            t.login().unwrap();
            match t.logout() {
                Err(TailnetError::Failed(e)) => assert_eq!(e, "nope"),
                other => panic!("{other:?}"),
            }
        }

        #[test]
        fn crashing_sidecar_is_restarted_three_times_then_fails() {
            let _g = lock(&SERIAL);
            let (_tmp, dir, t, rx) = start("exit 1", Duration::from_millis(10));
            wait_for("failed state", || {
                matches!(t.state(), TailnetState::Failed { .. })
            });
            assert_eq!(
                t.state(),
                TailnetState::Failed {
                    reason: "Tailscale を起動できません".into()
                }
            );
            // First run plus three restarts, and no more.
            thread::sleep(Duration::from_millis(200));
            assert_eq!(spawns(&dir), 4);
            let views: Vec<_> = rx.try_iter().collect();
            assert_eq!(views.last().unwrap().state, "failed");
            assert_eq!(t.proxy_url(), None);
            assert_eq!(
                t.resolve("nas", Duration::from_secs(1)),
                Err(ResolveError::NotRunning)
            );
        }

        #[test]
        fn a_running_status_resets_the_restart_counter() {
            let _g = lock(&SERIAL);
            // Reports `running`, then dies: every run is "healthy", so it never gives up.
            let body = format!("{READY}\n{RUNNING}\nexit 1");
            let (_tmp, dir, t, _rx) = start(&body, Duration::from_millis(10));
            wait_for("more than four spawns", || spawns(&dir) > 6);
            assert!(!matches!(t.state(), TailnetState::Failed { .. }));
        }

        #[test]
        fn exits_when_stdin_closes_and_drop_is_quick() {
            let _g = lock(&SERIAL);
            let body = format!("{READY}\n{WAIT_EOF}");
            let (_tmp, dir, t, _rx) = start(&body, Duration::from_millis(10));
            wait_for("ready", || t.proxy_url().is_some());
            let started = Instant::now();
            drop(t);
            assert!(started.elapsed() < Duration::from_secs(3));
            // No restart after an intentional stop.
            thread::sleep(Duration::from_millis(200));
            assert_eq!(spawns(&dir), 1);
        }

        #[test]
        fn drop_kills_a_child_that_ignores_stdin() {
            let _g = lock(&SERIAL);
            let (_tmp, _dir, t, _rx) = start("exec sleep 60", Duration::from_millis(10));
            thread::sleep(Duration::from_millis(100));
            let started = Instant::now();
            drop(t);
            let took = started.elapsed();
            assert!(
                took >= Duration::from_secs(2) && took < Duration::from_secs(6),
                "{took:?}"
            );
        }

        #[test]
        fn reset_wipes_the_state_dir_and_starts_again() {
            let _g = lock(&SERIAL);
            let body = format!("{READY}\n{WAIT_EOF}");
            let (_tmp, dir, t, rx) = start(&body, Duration::from_millis(10));
            wait_for("ready", || t.proxy_url().is_some());
            std::fs::write(dir.join("tailscaled.state"), "secret").unwrap();
            t.reset().unwrap();
            assert!(!dir.join("tailscaled.state").exists());
            // `spawns` was wiped with the folder and written once by the new child.
            wait_for("second child", || {
                spawns(&dir) == 1 && t.proxy_url().is_some()
            });
            assert!(matches!(t.state(), TailnetState::Starting { .. }));
            assert_eq!(rx.try_iter().last().unwrap().state, "starting");
            // The first child's exit was intentional, so nothing restarts it.
            thread::sleep(Duration::from_millis(200));
            assert_eq!(spawns(&dir), 1);
        }

        #[test]
        fn failed_reset_reports_failed() {
            use std::os::unix::fs::PermissionsExt;
            let _g = lock(&SERIAL);
            let body = format!("{READY}\n{RUNNING}\n{WAIT_EOF}");
            let (tmp, _dir, t, rx) = start_at(&body, Duration::from_millis(10), "parent/state");
            wait_for("running", || {
                matches!(t.state(), TailnetState::Running { .. })
            });
            // A read-only parent makes removing the state folder fail.
            let parent = tmp.path().join("parent");
            std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o555)).unwrap();
            // Root ignores directory permissions; nothing to test then.
            let probe = parent.join("probe");
            if std::fs::File::create(&probe).is_ok() {
                std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o755)).unwrap();
                return;
            }
            let result = t.reset();
            std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(matches!(result, Err(TailnetError::Failed(_))), "{result:?}");
            match t.state() {
                TailnetState::Failed { reason } => {
                    assert!(
                        reason.starts_with("Tailscale の状態を消せません: "),
                        "{reason}"
                    );
                }
                other => panic!("{other:?}"),
            }
            assert_eq!(rx.try_iter().last().unwrap().state, "failed");
            assert_eq!(t.proxy_url(), None);
        }

        #[test]
        fn failed_with_exit_is_not_shown_and_its_reason_is_kept() {
            let _g = lock(&SERIAL);
            let body = r#"echo '{"type":"status","state":"failed","error":"start: boom"}'; exit 1"#;
            let (_tmp, dir, t, rx) = start(body, Duration::from_millis(10));
            wait_for("failed state", || {
                matches!(t.state(), TailnetState::Failed { .. })
            });
            assert_eq!(
                t.state(),
                TailnetState::Failed {
                    reason: "start: boom".into()
                }
            );
            thread::sleep(Duration::from_millis(100));
            assert_eq!(spawns(&dir), 4);
            // Only the final give-up is announced as `failed`; the rest is `starting`.
            let states: Vec<_> = rx.try_iter().map(|v| v.state).collect();
            assert_eq!(
                states.iter().filter(|s| **s == "failed").count(),
                1,
                "{states:?}"
            );
            assert_eq!(*states.last().unwrap(), "failed");
        }

        #[test]
        fn starting_since_is_stable_across_restarts() {
            let _g = lock(&SERIAL);
            let body = r#"echo '{"type":"status","state":"failed","error":"x"}'; exit 1"#;
            let (_tmp, _dir, t, _rx) = start(body, Duration::from_millis(100));
            let TailnetState::Starting { since: first } = t.state() else {
                panic!("not starting");
            };
            thread::sleep(Duration::from_millis(250));
            assert_eq!(t.state(), TailnetState::Starting { since: first });
        }

        #[test]
        fn held_back_failed_from_a_stopped_sidecar_is_ignored() {
            let _g = lock(&SERIAL);
            // Only the first child says `failed`; it stays alive, so the reader is inside its
            // grace period when the test resets.
            let body = format!(
                "m=\"$(dirname \"$0\")/seen\"\nif [ ! -e \"$m\" ]; then touch \"$m\"; echo '{{\"type\":\"status\",\"state\":\"failed\",\"error\":\"old\"}}'; fi\n{WAIT_EOF}"
            );
            let (tmp, _dir, t, rx) = start(&body, Duration::from_millis(10));
            let seen = tmp.path().join("seen");
            wait_for("the first child to say failed", || seen.exists());
            thread::sleep(Duration::from_millis(100));
            t.reset().unwrap();
            // Outlast the 500 ms grace period of the old reader.
            thread::sleep(FAILED_GRACE + Duration::from_millis(300));
            let states: Vec<_> = rx.try_iter().map(|v| v.state).collect();
            assert!(!states.contains(&"failed"), "{states:?}");
            assert!(matches!(t.state(), TailnetState::Starting { .. }));
            assert_eq!(*lock(&t.inner.last_failure), None);
        }

        #[test]
        fn failed_without_exit_is_shown() {
            let _g = lock(&SERIAL);
            let body = format!(
                "echo '{{\"type\":\"status\",\"state\":\"failed\",\"error\":\"lc: down\"}}'\n{WAIT_EOF}"
            );
            let (_tmp, _dir, t, rx) = start(&body, Duration::from_millis(10));
            let view = rx.recv_timeout(Duration::from_secs(10)).unwrap();
            assert_eq!(view.state, "failed");
            assert_eq!(view.error.as_deref(), Some("lc: down"));
            assert!(matches!(t.state(), TailnetState::Failed { .. }));
        }

        #[test]
        fn request_in_flight_when_the_child_exits_is_not_running() {
            let _g = lock(&SERIAL);
            let body = format!("{READY}\nread line\nexit 0");
            let (_tmp, _dir, t, _rx) = start(&body, Duration::from_secs(5));
            wait_for("ready", || t.proxy_url().is_some());
            let started = Instant::now();
            assert_eq!(
                t.resolve("nas", Duration::from_secs(30)),
                Err(ResolveError::NotRunning)
            );
            assert!(started.elapsed() < Duration::from_secs(3));
        }
    }

    #[test]
    fn missing_binary_is_a_start_error() {
        let tmp = tempfile::tempdir().unwrap();
        let r = Tailnet::start(
            tmp.path().join("nope"),
            tmp.path().join("state"),
            "powertodo-test",
            |_| {},
        );
        assert!(matches!(r, Err(TailnetError::Spawn(_))));
    }

    // -- the real sidecar ------------------------------------------------------------------

    /// Needs the Task 1 binary (`node scripts/build-tailnet.mjs`) and network access to the
    /// Tailscale control server. Never logs in.
    #[test]
    #[ignore = "starts the real sidecar binary"]
    fn real_sidecar_starts_resolves_and_exits() {
        use std::sync::mpsc::channel;
        let binary = sidecar_path();
        assert!(binary.exists(), "missing {}", binary.display());
        let tmp = tempfile::tempdir().unwrap();
        let (tx, rx) = channel();
        let t = Tailnet::start(
            binary,
            tmp.path().join("tailscale"),
            "powertodo-test",
            move |v| {
                let _ = tx.send(v);
            },
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        while t.proxy_url().is_none() {
            assert!(Instant::now() < deadline, "no ready message");
            thread::sleep(Duration::from_millis(50));
        }
        assert!(t.proxy_url().unwrap().starts_with("socks5h://"));
        let view = rx.recv_timeout(Duration::from_secs(30)).expect("a status");
        assert!(
            ["needs_login", "starting"].contains(&view.state),
            "{view:?}"
        );
        assert_eq!(
            t.resolve("nas", Duration::from_secs(10)),
            Err(ResolveError::NotRunning)
        );
        let started = Instant::now();
        drop(t);
        assert!(started.elapsed() < Duration::from_secs(3), "slow exit");
    }
}
