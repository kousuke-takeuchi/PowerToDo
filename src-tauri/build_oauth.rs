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

/// The `CLIENT_ID` of the plist Google offers for an iOS client (`GoogleService-Info`-style
/// property list: `<key>CLIENT_ID</key><string>...</string>`). Only that one pair is read, so
/// no plist crate is needed. Like [`parse_google_oauth`], failures are fixed texts.
pub fn parse_google_ios_plist(text: &str) -> Result<String, &'static str> {
    const KEY: &str = "<key>CLIENT_ID</key>";
    let after = &text[text.find(KEY).ok_or("no CLIENT_ID key")? + KEY.len()..];
    let after = after.trim_start();
    let body = after
        .strip_prefix("<string>")
        .ok_or("CLIENT_ID is not a string")?;
    let value = body
        .split_once("</string>")
        .ok_or("CLIENT_ID is not closed")?
        .0
        .trim();
    if value.is_empty() {
        return Err("CLIENT_ID is empty");
    }
    // The value goes into a `cargo:rustc-env=` line: it must stay on one line.
    if value.chars().any(char::is_control) {
        return Err("CLIENT_ID contains a control character");
    }
    Ok(value.to_string())
}
