//! Reads the Google OAuth client out of Google's "desktop app" JSON (`{"installed": {...}}`).
//!
//! Shared by `build.rs` (which embeds the values) and, through `#[path]`, by the unit tests of
//! `sync::oauth`, so the parsing is tested for real. Nothing here ever returns, prints or
//! formats the file's contents on failure: the messages are fixed texts.
#![allow(dead_code)]

/// `(client_id, client_secret)`, or a fixed description of what is wrong with the file.
pub fn parse_google_oauth(json: &str) -> Result<(String, String), &'static str> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| "not valid JSON")?;
    let installed = value.get("installed").ok_or("no \"installed\" object")?;
    let field = |name: &'static str| -> Result<String, &'static str> {
        let s = installed
            .get(name)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or(match name {
                "client_id" => "\"installed.client_id\" is missing or empty",
                _ => "\"installed.client_secret\" is missing or empty",
            })?;
        // The value goes into a `cargo:rustc-env=` line: it must stay on one line.
        if s.chars().any(char::is_control) {
            return Err("a value contains a control character");
        }
        Ok(s.to_string())
    };
    Ok((field("client_id")?, field("client_secret")?))
}
