//! iOS-only helpers for PowerToDo (spec 3.3, 3.4, 6): network path changes (`NWPathMonitor`)
//! and the system login sheet (`ASWebAuthenticationSession`). On every other platform the
//! plugin is registered and does nothing.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
mod mobile;
#[cfg(not(target_os = "ios"))]
mod stub;

#[cfg(target_os = "ios")]
pub use mobile::PowerToDoIos;
#[cfg(not(target_os = "ios"))]
pub use stub::PowerToDoIos;

/// What `NWPathMonitor` reported.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PathInfo {
    /// `satisfied`, `unsatisfied` or `requiresConnection`.
    pub status: String,
    /// The interface types in use: `wifi`, `cellular`, `wiredEthernet`, `other`.
    pub interfaces: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The user closed the login sheet.
    #[error("cancelled")]
    Cancelled,
    /// Not running on iOS.
    #[error("unsupported on this platform")]
    Unsupported,
    #[error("{0}")]
    Failed(String),
}

pub type Result<T> = std::result::Result<T, Error>;

pub trait PowerToDoIosExt<R: Runtime> {
    fn powertodo_ios(&self) -> &PowerToDoIos<R>;
}

impl<R: Runtime, T: Manager<R>> PowerToDoIosExt<R> for T {
    fn powertodo_ios(&self) -> &PowerToDoIos<R> {
        self.state::<PowerToDoIos<R>>().inner()
    }
}

/// Whether `new` is a change worth reacting to: the first report only sets the baseline.
pub fn path_changed(previous: &Mutex<Option<PathInfo>>, new: &PathInfo) -> bool {
    let mut prev = previous.lock().unwrap_or_else(|e| e.into_inner());
    let changed = prev.as_ref().is_some_and(|p| p != new);
    *prev = Some(new.clone());
    changed
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("powertodo-ios")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let plugin = mobile::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let plugin = stub::init(app, api)?;
            app.manage(plugin);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(status: &str, interfaces: &[&str]) -> PathInfo {
        PathInfo {
            status: status.into(),
            interfaces: interfaces.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn the_first_report_is_only_a_baseline() {
        let prev = Mutex::new(None);
        assert!(!path_changed(&prev, &info("satisfied", &["wifi"])));
        assert!(!path_changed(&prev, &info("satisfied", &["wifi"])));
        assert!(path_changed(&prev, &info("satisfied", &["cellular"])));
        assert!(path_changed(&prev, &info("unsatisfied", &[])));
        assert!(!path_changed(&prev, &info("unsatisfied", &[])));
    }
}
