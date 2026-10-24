//! The Tailscale node inside the app (iOS): the Go c-archive `libtailnet.a` instead of the
//! desktop sidecar process. Same JSON messages as the sidecar ([`super::tailnet::Message`]),
//! read from `tn_next_event` instead of stdout, and the same shape of handle as
//! [`super::tailnet::Tailnet`] so `commands::sync` treats both alike.
//!
//! The C API sits behind [`TnApi`] so the logic runs (and is tested) on the desktop.
//!
//! Locking: the Go side has two races (`tn_stop` against `tn_proxy_open` can leave a listener on
//! a stopped node, `tn_start` right after `tn_stop` can overlap the old node's close on the same
//! state folder). So every lifecycle and proxy call (start, shutdown, reset, `ensure_proxy`,
//! `rebind`) runs under `Inner::lifecycle`, and `tn_stop` is always called, and has returned,
//! before any `tn_start`. `tn_command` is not a lifecycle call (a login waits for up to 30 s)
//! and does not take that lock. The `on_status` callback is never called with a lock held.

use std::collections::HashMap;
use std::io;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::tailnet::{
    LOGIN_TIMEOUT, LOGOUT_TIMEOUT, Message, ResolveError, TailnetError, TailnetState,
    TailnetStatusView, create_state_dir, parse_line,
};

/// The C API of `libtailnet.a`, behind a trait so the logic is tested on the desktop.
pub trait TnApi: Send + Sync + 'static {
    /// 0 started, 1 a node is already running, anything else: could not start.
    fn start(&self, state_dir: &Path, hostname: &str) -> i32;
    /// 0 queued; -1 no node or bad JSON (no `done` follows then).
    fn command(&self, json: &str) -> i32;
    fn next_event(&self, timeout_ms: i32) -> Option<String>;
    fn proxy_open(&self) -> Option<String>;
    fn proxy_close(&self);
    fn rebind(&self);
    /// Returns when the node has finished closing.
    fn stop(&self);
    /// The text shown when `start` refuses.
    fn start_error(&self) -> &'static str {
        START_FAILED_REASON
    }
}

#[cfg(tailnet_ffi)]
mod ffi {
    use std::ffi::{CStr, CString, c_char, c_int};
    use std::path::Path;

    // `libtailnet.h` (cgo) declares `char*` for every string. The parameters here are
    // `*const c_char`: the ABI is the same, and the Go side only reads them (`C.GoString`).
    unsafe extern "C" {
        fn tn_start(state_dir: *const c_char, hostname: *const c_char) -> c_int;
        fn tn_command(line: *const c_char) -> c_int;
        fn tn_next_event(timeout_ms: c_int) -> *mut c_char;
        fn tn_proxy_open() -> *mut c_char;
        fn tn_proxy_close();
        fn tn_rebind();
        fn tn_stop();
        fn tn_free(p: *mut c_char);
    }

    /// Takes a string the Go side allocated (and frees it).
    fn take(p: *mut c_char) -> Option<String> {
        if p.is_null() {
            return None;
        }
        // SAFETY: a non-null result of the library is a NUL-terminated C string.
        let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
        // SAFETY: `p` came from the library and is freed exactly once.
        unsafe { tn_free(p) };
        Some(s)
    }

    /// The real `libtailnet.a`.
    pub struct FfiApi;

    impl super::TnApi for FfiApi {
        fn start(&self, state_dir: &Path, hostname: &str) -> i32 {
            let (Ok(dir), Ok(host)) = (
                CString::new(state_dir.to_string_lossy().into_owned()),
                CString::new(hostname),
            ) else {
                return 2;
            };
            // SAFETY: both pointers are valid C strings for the duration of the call.
            unsafe { tn_start(dir.as_ptr(), host.as_ptr()) }
        }

        fn command(&self, json: &str) -> i32 {
            let Ok(line) = CString::new(json) else {
                return -1;
            };
            // SAFETY: a valid C string for the duration of the call.
            unsafe { tn_command(line.as_ptr()) }
        }

        fn next_event(&self, timeout_ms: i32) -> Option<String> {
            // SAFETY: no pointer arguments.
            take(unsafe { tn_next_event(timeout_ms) })
        }

        fn proxy_open(&self) -> Option<String> {
            // SAFETY: no pointer arguments.
            take(unsafe { tn_proxy_open() })
        }

        fn proxy_close(&self) {
            // SAFETY: no arguments.
            unsafe { tn_proxy_close() }
        }

        fn rebind(&self) {
            // SAFETY: no arguments.
            unsafe { tn_rebind() }
        }

        fn stop(&self) {
            // SAFETY: no arguments.
            unsafe { tn_stop() }
        }
    }
}

#[cfg(tailnet_ffi)]
pub use ffi::FfiApi;

/// For a build without `libtailnet.a`: starting always fails.
pub struct NoApi;

impl TnApi for NoApi {
    fn start(&self, _: &Path, _: &str) -> i32 {
        2
    }
    fn command(&self, _: &str) -> i32 {
        -1
    }
    fn next_event(&self, timeout_ms: i32) -> Option<String> {
        thread::sleep(Duration::from_millis(timeout_ms.clamp(0, 50) as u64));
        None
    }
    fn proxy_open(&self) -> Option<String> {
        None
    }
    fn proxy_close(&self) {}
    fn rebind(&self) {}
    fn stop(&self) {}
    fn start_error(&self) -> &'static str {
        NO_TAILSCALE_REASON
    }
}

pub const IOS_HOSTNAME: &str = "powertodo-ios";
/// A `failed` status after `running` waits this long for `running` again before it is shown
/// (spec 3.3: iOS suspends the app and the node reports `failed` while the network is away).
pub const FAILED_GRACE: Duration = Duration::from_secs(10);

const START_FAILED_REASON: &str = "Tailscale を起動できません";
const NO_TAILSCALE_REASON: &str = "このビルドには Tailscale が入っていません";
/// One `next_event` wait; also how long a reader needs to notice it was stopped.
const POLL_MS: i32 = 500;
/// How long the proxy port gets to accept a connection.
const ALIVE_TIMEOUT: Duration = Duration::from_millis(500);

/// What [`InProcTailnet::ensure_proxy`] found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyCheck {
    /// The listener answered; nothing was done.
    Alive,
    /// The listener was gone (iOS takes sockets of a suspended app); it was opened again.
    Reopened,
    /// No proxy: the node is not running or was shut down.
    Unavailable,
}

/// TCP connect to the proxy's 127.0.0.1 port within `timeout`.
pub fn proxy_alive(proxy_url: &str, timeout: Duration) -> bool {
    let Some(port) = url::Url::parse(proxy_url).ok().and_then(|u| u.port()) else {
        return false;
    };
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), timeout).is_ok()
}

/// The state folder is not part of an iCloud / iTunes backup (a restore on another device must
/// not clone the node key).
#[cfg(target_os = "ios")]
pub fn exclude_from_backup(dir: &Path) -> io::Result<()> {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSNumber, NSString, NSURL, NSURLIsExcludedFromBackupKey};
    let path = NSString::from_str(&dir.to_string_lossy());
    let url = NSURL::fileURLWithPath(&path);
    let yes = NSNumber::numberWithBool(true);
    let value: &AnyObject = &yes;
    // SAFETY: the value for NSURLIsExcludedFromBackupKey is an NSNumber (boolean).
    unsafe { url.setResourceValue_forKey_error(Some(value), NSURLIsExcludedFromBackupKey) }
        .map_err(|e| io::Error::other(format!("exclude from backup: {}", e.localizedDescription())))
}

// ---------------------------------------------------------------------------------------------

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

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

struct Inner {
    api: Arc<dyn TnApi>,
    dir: PathBuf,
    hostname: String,
    grace: Duration,
    on_status: Mutex<Box<dyn Fn(TailnetStatusView) + Send>>,

    state: Mutex<TailnetState>,
    proxy: Mutex<Option<String>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Reply>>>,
    next_id: AtomicU64,
    /// Serializes start / shutdown / reset / proxy calls / rebind (see the module comment).
    /// Lock order: `lifecycle`, then `reader`, then the small state locks.
    lifecycle: Mutex<()>,
    /// Bumped for every started reader and every stop; a reader whose number is no longer
    /// current ends.
    generation: AtomicU64,
    reader: Mutex<Option<JoinHandle<()>>>,
    /// `shutdown` was called: nothing starts again.
    closed: AtomicBool,
    /// A node was started (by this handle) and `tn_stop` has not been called since.
    node_up: AtomicBool,
}

impl Inner {
    fn emit(&self, state: &TailnetState) {
        let view = state.view();
        (lock(&self.on_status))(view);
    }

    fn fail_pending(&self) {
        lock(&self.pending).clear();
    }

    fn reply(&self, id: u64, reply: Reply) {
        if let Some(tx) = lock(&self.pending).remove(&id) {
            let _ = tx.send(reply);
        }
    }

    /// Stops the reader thread and the node; the node is closed when this returns. The
    /// caller holds `lifecycle`.
    fn stop_locked(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        // `tn_stop` first: it returns when the node has closed, and the reader (which may be
        // inside `tn_next_event`) is released by the generation bump within one poll.
        self.api.stop();
        self.node_up.store(false, Ordering::SeqCst);
        let handle = lock(&self.reader).take();
        if let Some(h) = handle
            && h.thread().id() != thread::current().id()
        {
            let _ = h.join();
        }
        // `tn_stop` queues a `stopped` status, a refused start a `failed` one (also drained in `start_locked`): they belong to
        // the node that is gone and must not reach the next reader.
        while self.api.next_event(1).is_some() {}
        *lock(&self.proxy) = None;
        self.fail_pending();
    }

    /// Starts the node, its reader and the proxy. The caller holds `lifecycle`. Returns the
    /// state this leaves (`Starting`, or `Failed` when `tn_start` refused).
    fn start_locked(self: &Arc<Self>) -> Result<TailnetState, TailnetError> {
        // Never `tn_start` over a node that is still closing (Go side race): stop first.
        self.api.stop();
        // A refused `tn_start` leaves its `failed` event in the process-global Go queue (no
        // reader runs then, and `shutdown` skips `stop_locked`): drop what is left of an
        // earlier node before this one starts.
        while self.api.next_event(1).is_some() {}
        create_state_dir(&self.dir)?;
        #[cfg(target_os = "ios")]
        exclude_from_backup(&self.dir)?;
        let rc = self.api.start(&self.dir, &self.hostname);
        if rc != 0 && rc != 1 {
            return Ok(TailnetState::Failed {
                reason: self.api.start_error().to_string(),
            });
        }
        self.node_up.store(true, Ordering::SeqCst);
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let reader_inner = Arc::clone(self);
        let handle = thread::Builder::new()
            .name("tailnet-reader".into())
            .spawn(move || reader_loop(reader_inner, generation))?;
        *lock(&self.reader) = Some(handle);
        // The one `tn_proxy_open` of a start. (Its `ready` event is ignored by the reader
        // once the URL is stored here.)
        *lock(&self.proxy) = self.api.proxy_open();
        Ok(TailnetState::Starting {
            since: Instant::now(),
        })
    }

    fn is_stale(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) != generation
    }
}

fn reader_loop(inner: Arc<Inner>, generation: u64) {
    // A `failed` that follows `running` is held back until the deadline.
    let mut held: Option<(Instant, TailnetState)> = None;
    loop {
        if inner.is_stale(generation) {
            return;
        }
        let wait_ms = match &held {
            Some((deadline, _)) => deadline
                .saturating_duration_since(Instant::now())
                .as_millis()
                .clamp(1, POLL_MS as u128) as i32,
            None => POLL_MS,
        };
        let line = inner.api.next_event(wait_ms);
        if inner.is_stale(generation) {
            return;
        }
        if let Some((deadline, _)) = &held
            && Instant::now() >= *deadline
            && let Some((_, failed)) = held.take()
        {
            *lock(&inner.state) = failed.clone();
            inner.emit(&failed);
        }
        let Some(msg) = line.as_deref().and_then(parse_line) else {
            continue;
        };
        match msg {
            Message::Ready { proxy } => {
                let mut slot = lock(&inner.proxy);
                if slot.is_none() {
                    *slot = Some(proxy);
                }
            }
            Message::Status {
                state,
                name,
                ip,
                login_url,
                error,
            } => {
                let new = {
                    let mut current = lock(&inner.state);
                    let Some(new) =
                        TailnetState::from_status(&state, name, ip, login_url, error, &current)
                    else {
                        continue;
                    };
                    if matches!(new, TailnetState::Failed { .. })
                        && matches!(*current, TailnetState::Running { .. })
                    {
                        // Keep showing `running`; `running` again cancels, the deadline
                        // commits.
                        held.get_or_insert_with(|| (Instant::now() + inner.grace, new));
                        continue;
                    }
                    held = None;
                    *current = new.clone();
                    new
                };
                inner.emit(&new);
            }
            Message::Resolved {
                id: Some(id),
                ip,
                error,
            } => inner.reply(id, Reply::Resolved { ip, error }),
            Message::Done {
                id: Some(id),
                error,
            } => inner.reply(id, Reply::Done { error }),
            Message::Resolved { id: None, .. } | Message::Done { id: None, .. } => {}
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Public handle

pub struct InProcTailnet {
    inner: Arc<Inner>,
}

impl InProcTailnet {
    /// Starts the node. `dir` is the Tailscale state folder (created with mode 0700, excluded
    /// from backup on iOS). `on_status` is called from the reader thread (and, for a start that
    /// failed, from this call) whenever the state changes; it must not call back into this
    /// handle. A `tn_start` that refuses gives `Ok` with the state `Failed`.
    pub fn start(
        api: Arc<dyn TnApi>,
        dir: PathBuf,
        hostname: &str,
        on_status: impl Fn(TailnetStatusView) + Send + 'static,
    ) -> Result<Self, TailnetError> {
        Self::start_with_grace(api, dir, hostname, FAILED_GRACE, on_status)
    }

    pub(crate) fn start_with_grace(
        api: Arc<dyn TnApi>,
        dir: PathBuf,
        hostname: &str,
        grace: Duration,
        on_status: impl Fn(TailnetStatusView) + Send + 'static,
    ) -> Result<Self, TailnetError> {
        let inner = Arc::new(Inner {
            api,
            dir,
            hostname: hostname.to_string(),
            grace,
            on_status: Mutex::new(Box::new(on_status)),
            state: Mutex::new(TailnetState::Starting {
                since: Instant::now(),
            }),
            proxy: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            lifecycle: Mutex::new(()),
            generation: AtomicU64::new(0),
            reader: Mutex::new(None),
            closed: AtomicBool::new(false),
            node_up: AtomicBool::new(false),
        });
        let new = {
            let _life = lock(&inner.lifecycle);
            inner.start_locked()?
        };
        if matches!(new, TailnetState::Failed { .. }) {
            *lock(&inner.state) = new.clone();
            inner.emit(&new);
        }
        Ok(InProcTailnet { inner })
    }

    /// The SOCKS5 proxy (`socks5h://user:pass@127.0.0.1:port`).
    pub fn proxy_url(&self) -> Option<String> {
        lock(&self.inner.proxy).clone()
    }

    pub fn state(&self) -> TailnetState {
        lock(&self.inner.state).clone()
    }

    /// Starts the interactive login. The URL arrives as a `needs_login` status.
    pub fn login(&self) -> Result<(), TailnetError> {
        self.login_with_timeout(LOGIN_TIMEOUT)
    }

    fn login_with_timeout(&self, timeout: Duration) -> Result<(), TailnetError> {
        self.command_done(|id| serde_json::json!({"cmd": "login", "id": id}), timeout)
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

    /// Stops the node, deletes the Tailscale state folder and starts it again, so the node
    /// comes back needing a login.
    pub fn reset(&self) -> Result<(), TailnetError> {
        let inner = &self.inner;
        let announce = {
            let _life = lock(&inner.lifecycle);
            if inner.closed.load(Ordering::SeqCst) {
                return Err(TailnetError::NotRunning);
            }
            inner.stop_locked();
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
            *lock(&inner.state) = TailnetState::Starting {
                since: Instant::now(),
            };
            match inner.start_locked() {
                Ok(state) => {
                    *lock(&inner.state) = state.clone();
                    state
                }
                Err(e) => {
                    let failed = TailnetState::Failed {
                        reason: START_FAILED_REASON.to_string(),
                    };
                    *lock(&inner.state) = failed.clone();
                    drop(_life);
                    inner.emit(&failed);
                    return Err(e);
                }
            }
        };
        inner.emit(&announce);
        Ok(())
    }

    /// Ends the node for good: the reader stops, `tn_stop` has returned before this does, and
    /// every request waiting fails with `NotRunning` at once. Idempotent. Other handles to
    /// the same `InProcTailnet` cannot keep the node alive.
    pub fn shutdown(&self) {
        let inner = &self.inner;
        inner.closed.store(true, Ordering::SeqCst);
        let _life = lock(&inner.lifecycle);
        if inner.node_up.load(Ordering::SeqCst) {
            inner.stop_locked();
        }
        *lock(&inner.proxy) = None;
        inner.fail_pending();
    }

    /// Before a sync: the listener answers on 127.0.0.1, else close + open (spec 3.2). iOS
    /// takes the sockets of a suspended app, so the listener can be dead without a sign.
    pub fn ensure_proxy(&self) -> ProxyCheck {
        let inner = &self.inner;
        let _life = lock(&inner.lifecycle);
        if inner.closed.load(Ordering::SeqCst) || !inner.node_up.load(Ordering::SeqCst) {
            return ProxyCheck::Unavailable;
        }
        let current = lock(&inner.proxy).clone();
        if let Some(url) = &current
            && proxy_alive(url, ALIVE_TIMEOUT)
        {
            return ProxyCheck::Alive;
        }
        inner.api.proxy_close();
        let opened = inner.api.proxy_open();
        let check = if opened.is_some() {
            ProxyCheck::Reopened
        } else {
            ProxyCheck::Unavailable
        };
        *lock(&inner.proxy) = opened;
        check
    }

    /// Tells the node the network may have changed (the app is in the foreground again).
    pub fn rebind(&self) {
        let _life = lock(&self.inner.lifecycle);
        if !self.inner.closed.load(Ordering::SeqCst) && self.inner.node_up.load(Ordering::SeqCst) {
            self.inner.api.rebind();
        }
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
        if inner.closed.load(Ordering::SeqCst) {
            return Err(TailnetError::NotRunning);
        }
        let id = inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        lock(&inner.pending).insert(id, tx);
        // -1 (no node, bad JSON) is final: no `done` follows.
        if inner.api.command(&build(id).to_string()) != 0 {
            lock(&inner.pending).remove(&id);
            return Err(TailnetError::NotRunning);
        }
        match rx.recv_timeout(timeout) {
            Ok(reply) => Ok(reply),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                lock(&inner.pending).remove(&id);
                Err(TailnetError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(TailnetError::NotRunning),
        }
    }
}

impl Drop for InProcTailnet {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::net::TcpListener;
    use std::sync::Condvar;

    #[derive(Default)]
    struct FakeState {
        events: VecDeque<String>,
        calls: Vec<String>,
        listener: Option<TcpListener>,
        stopped: bool,
    }

    struct FakeApi {
        start_rc: std::sync::atomic::AtomicI32,
        s: Mutex<FakeState>,
        cv: Condvar,
    }

    impl FakeApi {
        fn new(start_rc: i32) -> Arc<Self> {
            Arc::new(Self {
                start_rc: start_rc.into(),
                s: Mutex::new(FakeState::default()),
                cv: Condvar::new(),
            })
        }
        fn push(&self, line: &str) {
            lock(&self.s).events.push_back(line.to_string());
            self.cv.notify_all();
        }
        fn count(&self, name: &str) -> usize {
            lock(&self.s).calls.iter().filter(|c| *c == name).count()
        }
        fn calls(&self) -> Vec<String> {
            lock(&self.s).calls.clone()
        }
        fn drop_listener(&self) {
            lock(&self.s).listener = None;
        }
        fn has_listener(&self) -> bool {
            lock(&self.s).listener.is_some()
        }
    }

    impl TnApi for FakeApi {
        fn start(&self, _: &Path, _: &str) -> i32 {
            let mut s = lock(&self.s);
            s.calls.push("start".into());
            s.stopped = false;
            let rc = self.start_rc.load(Ordering::SeqCst);
            if rc != 0 && rc != 1 {
                s.events.push_back(FAILED.to_string());
            }
            rc
        }
        fn command(&self, json: &str) -> i32 {
            lock(&self.s).calls.push(format!("command {json}"));
            0
        }
        fn next_event(&self, timeout_ms: i32) -> Option<String> {
            let s = lock(&self.s);
            let (mut s, _) = self
                .cv
                .wait_timeout_while(s, Duration::from_millis(timeout_ms as u64), |s| {
                    s.events.is_empty()
                })
                .unwrap();
            s.events.pop_front()
        }
        fn proxy_open(&self) -> Option<String> {
            let mut s = lock(&self.s);
            s.calls.push("proxy_open".into());
            // Like the Go race: opens even when the node is stopped.
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = l.local_addr().unwrap().port();
            s.listener = Some(l);
            Some(format!("socks5h://tsnet:pw@127.0.0.1:{port}"))
        }
        fn proxy_close(&self) {
            let mut s = lock(&self.s);
            s.calls.push("proxy_close".into());
            s.listener = None;
        }
        fn rebind(&self) {
            lock(&self.s).calls.push("rebind".into());
        }
        fn stop(&self) {
            let mut s = lock(&self.s);
            s.calls.push("stop".into());
            s.stopped = true;
            s.listener = None;
        }
    }

    type Seen = Arc<Mutex<Vec<TailnetStatusView>>>;

    fn start(api: &Arc<FakeApi>, dir: &Path, grace: Duration) -> (InProcTailnet, Seen) {
        let seen: Seen = Arc::default();
        let sink = Arc::clone(&seen);
        let t = InProcTailnet::start_with_grace(
            api.clone(),
            dir.to_path_buf(),
            IOS_HOSTNAME,
            grace,
            move |v| lock(&sink).push(v),
        )
        .unwrap();
        (t, seen)
    }

    fn states(seen: &Seen) -> Vec<&'static str> {
        lock(seen).iter().map(|v| v.state).collect()
    }

    fn wait_until(what: &str, cond: impl Fn() -> bool) {
        let end = Instant::now() + Duration::from_secs(5);
        while !cond() {
            assert!(Instant::now() < end, "timed out waiting for {what}");
            thread::sleep(Duration::from_millis(5));
        }
    }

    const RUNNING: &str =
        r#"{"type":"status","state":"running","name":"powertodo-ios","ip":"100.64.0.9"}"#;
    const FAILED: &str = r#"{"type":"status","state":"failed","error":"boom"}"#;

    #[test]
    fn start_failure_is_failed_state() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(2);
        let (t, seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        assert!(matches!(t.state(), TailnetState::Failed { .. }));
        assert_eq!(states(&seen), ["failed"]);
        assert_eq!(api.count("proxy_open"), 0);
    }

    #[test]
    fn a_refused_start_leaves_no_failed_event_for_the_next_start() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(2);
        let (t1, _seen1) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        assert!(matches!(t1.state(), TailnetState::Failed { .. }));
        t1.shutdown(); // like 「再試行」: skips stop_locked, nothing drains
        api.start_rc.store(0, Ordering::SeqCst);
        let (t2, seen2) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        thread::sleep(Duration::from_millis(1200)); // a few reader polls
        assert!(states(&seen2).is_empty(), "{:?}", states(&seen2));
        assert!(matches!(t2.state(), TailnetState::Starting { .. }));
    }

    #[test]
    fn status_events_update_the_state() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        assert!(matches!(t.state(), TailnetState::Starting { .. }));
        api.push(RUNNING);
        wait_until("running", || states(&seen) == ["running"]);
        assert_eq!(
            t.state(),
            TailnetState::Running {
                name: "powertodo-ios".into(),
                ip: "100.64.0.9".into()
            }
        );
        // The one proxy_open of the start.
        assert_eq!(api.count("proxy_open"), 1);
        assert!(t.proxy_url().is_some());
    }

    #[test]
    fn login_waits_for_done() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, _seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        let t = Arc::new(t);
        let t2 = Arc::clone(&t);
        let h = thread::spawn(move || t2.login());
        wait_until("the login command", || {
            api.calls()
                .iter()
                .any(|c| c == r#"command {"cmd":"login","id":1}"#)
        });
        api.push(r#"{"type":"done","id":1}"#);
        assert!(h.join().unwrap().is_ok());

        // No answer: Timeout (short timeout instead of LOGIN_TIMEOUT).
        let r = t.login_with_timeout(Duration::from_millis(50));
        assert!(matches!(r, Err(TailnetError::Timeout)), "{r:?}");
    }

    #[test]
    fn a_refused_command_fails_at_once() {
        struct Refusing(Arc<FakeApi>);
        impl TnApi for Refusing {
            fn start(&self, d: &Path, h: &str) -> i32 {
                self.0.start(d, h)
            }
            fn command(&self, _: &str) -> i32 {
                -1
            }
            fn next_event(&self, t: i32) -> Option<String> {
                self.0.next_event(t)
            }
            fn proxy_open(&self) -> Option<String> {
                self.0.proxy_open()
            }
            fn proxy_close(&self) {
                self.0.proxy_close()
            }
            fn rebind(&self) {}
            fn stop(&self) {
                self.0.stop()
            }
        }
        let tmp = tempfile::tempdir().unwrap();
        let t = InProcTailnet::start(
            Arc::new(Refusing(FakeApi::new(0))),
            tmp.path().join("ts"),
            IOS_HOSTNAME,
            |_| {},
        )
        .unwrap();
        let begun = Instant::now();
        assert!(matches!(t.login(), Err(TailnetError::NotRunning)));
        assert!(begun.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn resolve_maps_not_in_tailnet() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, _seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        let t = Arc::new(t);
        let t2 = Arc::clone(&t);
        let h = thread::spawn(move || t2.resolve("nas", Duration::from_secs(5)));
        wait_until("the resolve command", || {
            api.calls().iter().any(|c| c.contains(r#""cmd":"resolve""#))
        });
        api.push(r#"{"type":"resolved","id":1,"error":"not_in_tailnet"}"#);
        assert_eq!(h.join().unwrap(), Err(ResolveError::NotInTailnet));

        let t2 = Arc::clone(&t);
        let h = thread::spawn(move || t2.resolve("nas", Duration::from_secs(5)));
        wait_until("the second resolve", || {
            api.count("start") == 1 && {
                api.calls()
                    .iter()
                    .filter(|c| c.contains(r#""cmd":"resolve""#))
                    .count()
                    == 2
            }
        });
        api.push(r#"{"type":"resolved","id":2,"ip":"100.64.0.2"}"#);
        assert_eq!(h.join().unwrap(), Ok("100.64.0.2".parse().unwrap()));
    }

    #[test]
    fn ensure_proxy_reopens_a_dead_listener() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, _seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        let first = t.proxy_url().unwrap();
        assert!(proxy_alive(&first, Duration::from_millis(500)));
        api.drop_listener(); // iOS took the socket
        assert!(!proxy_alive(&first, Duration::from_millis(500)));
        assert_eq!(t.ensure_proxy(), ProxyCheck::Reopened);
        let second = t.proxy_url().unwrap();
        assert_ne!(first, second);
        assert!(proxy_alive(&second, Duration::from_millis(500)));
        assert_eq!(api.count("proxy_open"), 2);
    }

    #[test]
    fn ensure_proxy_keeps_a_live_listener() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, _seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        let before = t.proxy_url();
        assert_eq!(t.ensure_proxy(), ProxyCheck::Alive);
        assert_eq!(api.count("proxy_open"), 1);
        assert_eq!(api.count("proxy_close"), 0);
        assert_eq!(t.proxy_url(), before);
    }

    #[test]
    fn failed_within_grace_is_not_shown() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, seen) = start(&api, &tmp.path().join("ts"), Duration::from_millis(300));
        api.push(RUNNING);
        wait_until("running", || states(&seen) == ["running"]);
        api.push(FAILED);
        thread::sleep(Duration::from_millis(50));
        api.push(RUNNING);
        // Well past the grace: still no failed.
        thread::sleep(Duration::from_millis(500));
        assert!(!states(&seen).contains(&"failed"), "{:?}", states(&seen));
        assert!(matches!(t.state(), TailnetState::Running { .. }));

        // running -> failed and no recovery: shown after the grace.
        let begun = Instant::now();
        api.push(FAILED);
        wait_until("failed", || states(&seen).contains(&"failed"));
        assert!(begun.elapsed() >= Duration::from_millis(250));
        assert!(matches!(t.state(), TailnetState::Failed { .. }));
    }

    #[test]
    fn failed_outside_running_is_shown_at_once() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, seen) = start(&api, &tmp.path().join("ts"), Duration::from_secs(60));
        api.push(FAILED);
        wait_until("failed", || states(&seen) == ["failed"]);
        assert!(matches!(t.state(), TailnetState::Failed { .. }));
    }

    #[test]
    fn shutdown_is_idempotent_and_stops_the_reader() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        t.shutdown();
        t.shutdown();
        // start() stops once before starting, shutdown() once.
        assert_eq!(api.count("stop"), 2);
        assert!(lock(&t.inner.reader).is_none());
        assert_eq!(t.proxy_url(), None);
        // The reader is gone: events are no longer consumed.
        api.push(RUNNING);
        thread::sleep(Duration::from_millis(100));
        assert!(states(&seen).is_empty());
        assert_eq!(t.ensure_proxy(), ProxyCheck::Unavailable);
        assert!(matches!(t.login(), Err(TailnetError::NotRunning)));
        drop(t); // Drop calls shutdown again
        assert_eq!(api.count("stop"), 2);
    }

    #[test]
    fn stop_always_precedes_start() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("ts");
        let api = FakeApi::new(0);
        let (t, _seen) = start(&api, &dir, FAILED_GRACE);
        t.reset().unwrap();
        let calls = api.calls();
        for (i, c) in calls.iter().enumerate() {
            if c == "start" {
                assert_eq!(calls[i - 1], "stop", "{calls:?}");
            }
        }
        assert_eq!(api.count("start"), 2);
    }

    #[test]
    fn reset_removes_the_state_dir_and_starts_again() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("ts");
        let api = FakeApi::new(0);
        let (t, seen) = start(&api, &dir, FAILED_GRACE);
        std::fs::write(dir.join("tailscaled.state"), "x").unwrap();
        api.push(RUNNING);
        wait_until("running", || states(&seen) == ["running"]);
        // A stale event of the old node must not reach the new reader.
        api.push(r#"{"type":"status","state":"stopped"}"#);
        t.reset().unwrap();
        assert!(!dir.join("tailscaled.state").exists());
        assert!(dir.is_dir());
        assert_eq!(api.count("start"), 2);
        assert_eq!(api.count("proxy_open"), 2);
        assert!(matches!(t.state(), TailnetState::Starting { .. }));
        assert_eq!(states(&seen).last(), Some(&"starting"));
        assert!(t.proxy_url().is_some());
        // The new reader works.
        api.push(RUNNING);
        wait_until("running again", || {
            matches!(t.state(), TailnetState::Running { .. })
        });
        assert!(!states(&seen).contains(&"stopped"));
    }

    #[test]
    fn ensure_proxy_and_shutdown_never_leave_a_proxy_open() {
        for round in 0..8 {
            let tmp = tempfile::tempdir().unwrap();
            let api = FakeApi::new(0);
            let (t, _seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
            let t = Arc::new(t);
            let stop = Arc::new(AtomicBool::new(false));
            let worker = {
                let t = Arc::clone(&t);
                let stop = Arc::clone(&stop);
                thread::spawn(move || {
                    while !stop.load(Ordering::SeqCst) {
                        t.ensure_proxy();
                        // Make the listener dead so ensure_proxy keeps reopening.
                    }
                })
            };
            let killer = {
                let api = Arc::clone(&api);
                let stop = Arc::clone(&stop);
                thread::spawn(move || {
                    while !stop.load(Ordering::SeqCst) {
                        api.drop_listener();
                    }
                })
            };
            thread::sleep(Duration::from_millis(5 + round % 7));
            t.shutdown();
            // Whatever the worker does next, nothing may open a proxy again.
            stop.store(true, Ordering::SeqCst);
            worker.join().unwrap();
            killer.join().unwrap();
            assert!(
                !api.has_listener(),
                "round {round}: a proxy outlived shutdown"
            );
            assert_eq!(t.proxy_url(), None);
        }
    }

    #[test]
    fn no_api_start_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let seen: Seen = Arc::default();
        let sink = Arc::clone(&seen);
        let t = InProcTailnet::start(
            Arc::new(NoApi),
            tmp.path().join("ts"),
            IOS_HOSTNAME,
            move |v| lock(&sink).push(v),
        )
        .unwrap();
        assert!(matches!(t.state(), TailnetState::Failed { .. }));
        assert_eq!(states(&seen), ["failed"]);
    }

    #[test]
    fn rebind_reaches_a_running_node_only() {
        let tmp = tempfile::tempdir().unwrap();
        let api = FakeApi::new(0);
        let (t, _seen) = start(&api, &tmp.path().join("ts"), FAILED_GRACE);
        t.rebind();
        assert_eq!(api.count("rebind"), 1);
        t.shutdown();
        t.rebind();
        assert_eq!(api.count("rebind"), 1);
    }
}
