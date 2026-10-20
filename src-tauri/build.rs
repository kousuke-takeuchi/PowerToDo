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
    if is_windows_msvc() {
        // tauri-build puts its manifest (Common Controls v6) into a resource that is linked into
        // the app binary only (`cargo:rustc-link-arg-bins`). The lib's test binary then loads the
        // old comctl32 and dies at start with STATUS_ENTRYPOINT_NOT_FOUND once the tests build a
        // `tauri::test` mock app (`commands::update`). Same workaround as the tauri crate's own
        // build.rs (`embed_manifest_for_tests`): the linker embeds the same manifest into every
        // binary, and tauri-build adds none of its own (two would be a duplicate resource).
        embed_windows_manifest();
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        if let Err(error) = tauri_build::try_build(attributes) {
            println!("{error:#}");
            std::process::exit(1);
        }
    } else {
        tauri_build::build()
    }
}

fn is_windows_msvc() -> bool {
    std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

/// `windows-app-manifest.xml` is tauri-build's default manifest (tauri-build 2.7.2
/// `src/windows-app-manifest.xml`), unchanged.
fn embed_windows_manifest() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_default())
        .join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
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
