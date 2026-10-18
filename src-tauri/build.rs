#[path = "build_oauth.rs"]
mod build_oauth;

use std::path::PathBuf;

fn main() {
    // The target triple, for finding the sidecar binary in a development tree
    // (`binaries/powertodo-tailnet-<triple>`); see `sync::tailnet::sidecar_path`.
    println!(
        "cargo:rustc-env=POWERTODO_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    embed_google_oauth();
    tauri_build::build()
}

/// Embeds the Google OAuth client (spec section 5) from `POWERTODO_GOOGLE_OAUTH_JSON`, else from
/// `google-oauth.json` next to this file. Without the file nothing is embedded and the build
/// still passes (CI): `sync::oauth::client()` is then `None`. Only the `cargo:` lines below
/// are printed, never a value from the file, and a malformed file only produces a warning.
fn embed_google_oauth() {
    println!("cargo:rerun-if-env-changed=POWERTODO_GOOGLE_OAUTH_JSON");
    let path = match std::env::var_os("POWERTODO_GOOGLE_OAUTH_JSON") {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_default())
            .join("google-oauth.json"),
    };
    let Ok(json) = std::fs::read_to_string(&path) else {
        // Not watched while it is absent: cargo treats a missing watched file as always
        // changed, which would rebuild the crate on every `cargo build`. Adding the file later
        // needs a `touch build.rs` (or setting the env var, which is watched).
        return;
    };
    println!("cargo:rerun-if-changed={}", path.display());
    match build_oauth::parse_google_oauth(&json) {
        Ok((id, secret)) => {
            println!("cargo:rustc-env=POWERTODO_GOOGLE_CLIENT_ID={id}");
            println!("cargo:rustc-env=POWERTODO_GOOGLE_CLIENT_SECRET={secret}");
        }
        Err(why) => println!(
            "cargo:warning=the Google OAuth json is unusable ({why}); Google Drive sync is disabled in this build"
        ),
    }
}
