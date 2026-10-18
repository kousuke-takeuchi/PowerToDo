//! The TLS crypto provider for every HTTP client of the sync (spec section 9).
//!
//! reqwest is built with `rustls-no-provider`, so it has none of its own and panics when a
//! client is built before one is installed. `ring` is used instead of rustls' default aws-lc-rs
//! because aws-lc-sys is a C build that needs extra tooling on Windows.

use std::sync::OnceLock;

/// Installs `ring` as the process-wide rustls provider, once. Safe to call from anywhere, any
/// number of times: the app start-up calls it, and so does every constructor of an HTTP
/// client (also in tests). A provider installed by someone else first is kept.
pub fn install_crypto_provider() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        // `Err` means a provider is already installed, which is just as good.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installing_twice_leaves_a_provider_and_clients_build() {
        install_crypto_provider();
        install_crypto_provider();
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
        // A client builds (with TLS configured) without any further setup.
        reqwest::Client::builder().build().unwrap();
    }
}
