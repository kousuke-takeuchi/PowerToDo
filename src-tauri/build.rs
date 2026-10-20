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
    embed_google_ios_oauth();
    link_ios_tailnet();
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

/// Links the tsnet c-archive (`scripts/build-tailnet-ios.sh <target>`) into the iOS app and sets
/// `cfg(tailnet_ffi)`. The archive is bundled into the staticlib (`libapp.a`) that Xcode links.
/// Without the archive nothing is linked and the cfg stays unset, so `cargo check` for iOS passes
/// without a Go toolchain (CI); the app then has no Tailscale.
fn link_ios_tailnet() {
    println!("cargo:rustc-check-cfg=cfg(tailnet_ffi)");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }
    // aarch64-apple-ios-sim has target_abi = "sim"; the device target has "".
    let sim = std::env::var("CARGO_CFG_TARGET_ABI").as_deref() == Ok("sim");
    let target = if sim {
        "aarch64-apple-ios-sim"
    } else {
        "aarch64-apple-ios"
    };
    let dir = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_default())
        .join("binaries")
        .join("ios")
        .join(target);
    let lib = dir.join("libtailnet.a");
    println!("cargo:rerun-if-changed={}", lib.display());
    if !lib.exists() {
        println!(
            "cargo:warning={} is missing (run scripts/build-tailnet-ios.sh {target}): Tailscale is not in this build",
            lib.display()
        );
        return;
    }
    println!("cargo:rustc-link-search=native={}", dir.display());
    println!("cargo:rustc-link-lib=static=tailnet");
    println!("cargo:rustc-cfg=tailnet_ffi");
}

/// Embeds the Google OAuth client of the iOS app (an installed-app client of type iOS: a client
/// id, no secret) from `POWERTODO_GOOGLE_IOS_OAUTH_PLIST`, else from `google-oauth-ios.plist`
/// next to this file. Only for iOS targets; the desktop json is not read for iOS. Without the
/// file nothing is embedded and the build passes: Google Drive is then unavailable. Only the
/// `cargo:` lines are printed, never the value.
fn embed_google_ios_oauth() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }
    println!("cargo:rerun-if-env-changed=POWERTODO_GOOGLE_IOS_OAUTH_PLIST");
    let path = match std::env::var_os("POWERTODO_GOOGLE_IOS_OAUTH_PLIST") {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_default())
            .join("google-oauth-ios.plist"),
    };
    // Not watched while absent (see `embed_google_oauth`).
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    println!("cargo:rerun-if-changed={}", path.display());
    match build_oauth::parse_google_ios_plist(&text) {
        Ok(id) => println!("cargo:rustc-env=POWERTODO_GOOGLE_IOS_CLIENT_ID={id}"),
        Err(why) => println!(
            "cargo:warning=the Google iOS OAuth plist is unusable ({why}); Google Drive sync is disabled in this build"
        ),
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
/// Not for iOS targets: the desktop client has a secret that must not reach the iOS binary
/// (see `embed_google_ios_oauth`).
fn embed_google_oauth() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        return;
    }
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
