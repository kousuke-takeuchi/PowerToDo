//! Every platform but iOS: nothing to do.

use std::marker::PhantomData;

use tauri::plugin::PluginApi;
use tauri::{AppHandle, Runtime};

use crate::{Error, PathInfo, Result};

pub struct PowerToDoIos<R: Runtime>(PhantomData<fn() -> R>);

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<PowerToDoIos<R>> {
    Ok(PowerToDoIos(PhantomData))
}

impl<R: Runtime> PowerToDoIos<R> {
    /// Does nothing off iOS.
    pub fn on_path_change(
        &self,
        _handler: impl Fn(PathInfo) + Send + Sync + 'static,
    ) -> Result<()> {
        Ok(())
    }

    /// Always `Err(Error::Unsupported)` off iOS.
    pub fn authenticate(&self, _url: &str, _callback_scheme: &str) -> Result<String> {
        Err(Error::Unsupported)
    }
}
