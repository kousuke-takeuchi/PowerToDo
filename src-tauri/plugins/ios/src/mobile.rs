//! iOS: the Swift plugin `PowerToDoIosPlugin` (`ios/Sources`).

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::plugin::{PluginApi, PluginHandle};
use tauri::{AppHandle, Runtime};

use crate::{Error, PathInfo, Result};

tauri::ios_plugin_binding!(init_plugin_powertodo_ios);

pub struct PowerToDoIos<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<PowerToDoIos<R>> {
    let handle = api
        .register_ios_plugin(init_plugin_powertodo_ios)
        .map_err(|e| Error::Failed(e.to_string()))?;
    Ok(PowerToDoIos(handle))
}

impl<R: Runtime> PowerToDoIos<R> {
    /// Calls `handler` for every report of the path monitor. The first report after this call
    /// is the current state; the caller decides what counts as a change (`path_changed`).
    pub fn on_path_change(&self, handler: impl Fn(PathInfo) + Send + Sync + 'static) -> Result<()> {
        #[derive(Serialize)]
        struct RegisterListener {
            event: &'static str,
            handler: Channel,
        }
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(payload) = body
                && let Ok(info) = serde_json::from_str::<PathInfo>(&payload)
            {
                handler(info);
            }
            Ok(())
        });
        let failed = |e: tauri::plugin::mobile::PluginInvokeError| Error::Failed(e.to_string());
        self.0
            .run_mobile_plugin::<()>(
                "registerListener",
                RegisterListener {
                    event: "pathChanged",
                    handler: channel,
                },
            )
            .map_err(failed)?;
        // Started after the listener exists, so the first report is not lost.
        self.0
            .run_mobile_plugin::<()>("startPathMonitor", ())
            .map_err(failed)
    }

    /// Opens `url` in the system login sheet and returns the URL it ended on (starting with
    /// `callback_scheme`). Blocks until the sheet closes: call it off the main thread. The user
    /// closing the sheet is `Err(Error::Cancelled)`.
    pub fn authenticate(&self, url: &str, callback_scheme: &str) -> Result<String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            url: &'a str,
            callback_scheme: &'a str,
        }
        #[derive(Deserialize)]
        struct Reply {
            url: String,
        }
        use tauri::plugin::mobile::PluginInvokeError;
        match self.0.run_mobile_plugin::<Reply>(
            "authenticate",
            Args {
                url,
                callback_scheme,
            },
        ) {
            Ok(r) => Ok(r.url),
            Err(PluginInvokeError::InvokeRejected(e)) if e.code.as_deref() == Some("cancelled") => {
                Err(Error::Cancelled)
            }
            Err(e) => Err(Error::Failed(e.to_string())),
        }
    }
}
