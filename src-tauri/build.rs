fn main() {
    // The target triple, for finding the sidecar binary in a development tree
    // (`binaries/powertodo-tailnet-<triple>`); see `sync::tailnet::sidecar_path`.
    println!(
        "cargo:rustc-env=POWERTODO_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    tauri_build::build()
}
