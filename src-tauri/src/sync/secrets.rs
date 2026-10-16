//! Passwords and tokens of the sync targets (spec section 7): kept in the OS keychain, never in
//! a file of ours. [`SecretStore`] is what the rest of the app sees; [`KeyringStore`] is the
//! keychain (macOS Keychain, Windows Credential Manager, the Secret Service on Linux) and
//! [`MemoryStore`] stands in for it in tests and, for the rest of the session, when the keychain
//! cannot be used (the caller tells the user: 「パスワードを保存できません (再起動するまで有効)」).

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

/// Service name of the NAS password (account: `<user>@<host>`, chosen by the caller).
pub const NAS_SERVICE: &str = "app.powertodo.nas";
/// Service name of the Google refresh token.
pub const GOOGLE_SERVICE: &str = "app.powertodo.google";

/// The keychain failed. The text can be shown to the user as it is.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct SecretError(pub String);

pub type SecretResult<T> = Result<T, SecretError>;

pub trait SecretStore: Send + Sync {
    /// `Ok(None)` when nothing is stored under `service` / `account`.
    fn get(&self, service: &str, account: &str) -> SecretResult<Option<String>>;
    fn set(&self, service: &str, account: &str, secret: &str) -> SecretResult<()>;
    /// Deleting what is not there is not an error.
    fn delete(&self, service: &str, account: &str) -> SecretResult<()>;
}

/// The OS keychain, through `keyring::v1::Entry`.
#[derive(Debug, Default, Clone, Copy)]
pub struct KeyringStore;

fn keychain_error(e: &keyring::v1::Error) -> SecretError {
    use keyring::v1::Error;
    SecretError(match e {
        Error::NoDefaultStore => "このシステムにはキーチェーンがありません".to_string(),
        Error::NoStorageAccess(_) => {
            format!("キーチェーンを使えません (ロックされていませんか): {e}")
        }
        Error::BadEncoding(_) | Error::BadDataFormat(..) => {
            format!("キーチェーンの値を読めません: {e}")
        }
        _ => format!("キーチェーンを使えません: {e}"),
    })
}

fn entry(service: &str, account: &str) -> SecretResult<keyring::v1::Entry> {
    keyring::v1::Entry::new(service, account).map_err(|e| keychain_error(&e))
}

impl SecretStore for KeyringStore {
    fn get(&self, service: &str, account: &str) -> SecretResult<Option<String>> {
        match entry(service, account)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::v1::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_error(&e)),
        }
    }

    fn set(&self, service: &str, account: &str, secret: &str) -> SecretResult<()> {
        entry(service, account)?
            .set_password(secret)
            .map_err(|e| keychain_error(&e))
    }

    fn delete(&self, service: &str, account: &str) -> SecretResult<()> {
        match entry(service, account)?.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error(&e)),
        }
    }
}

/// Secrets held in memory only: gone when the app quits.
#[derive(Debug, Default)]
pub struct MemoryStore {
    secrets: Mutex<BTreeMap<(String, String), String>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, BTreeMap<(String, String), String>> {
        self.secrets.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, service: &str, account: &str) -> SecretResult<Option<String>> {
        Ok(self
            .lock()
            .get(&(service.to_string(), account.to_string()))
            .cloned())
    }

    fn set(&self, service: &str, account: &str, secret: &str) -> SecretResult<()> {
        self.lock().insert(
            (service.to_string(), account.to_string()),
            secret.to_string(),
        );
        Ok(())
    }

    fn delete(&self, service: &str, account: &str) -> SecretResult<()> {
        self.lock()
            .remove(&(service.to_string(), account.to_string()));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trips() {
        let s = MemoryStore::new();
        assert_eq!(s.get(NAS_SERVICE, "taro@nas").unwrap(), None);
        s.set(NAS_SERVICE, "taro@nas", "パス ワード").unwrap();
        assert_eq!(
            s.get(NAS_SERVICE, "taro@nas").unwrap().as_deref(),
            Some("パス ワード")
        );
        // Another service or account is another secret.
        assert_eq!(s.get(GOOGLE_SERVICE, "taro@nas").unwrap(), None);
        assert_eq!(s.get(NAS_SERVICE, "hanako@nas").unwrap(), None);
        s.set(NAS_SERVICE, "taro@nas", "新しい").unwrap();
        assert_eq!(
            s.get(NAS_SERVICE, "taro@nas").unwrap().as_deref(),
            Some("新しい")
        );
        s.delete(NAS_SERVICE, "taro@nas").unwrap();
        assert_eq!(s.get(NAS_SERVICE, "taro@nas").unwrap(), None);
        // Deleting what is not there is fine.
        s.delete(NAS_SERVICE, "taro@nas").unwrap();
    }

    #[test]
    fn the_store_is_usable_as_a_trait_object() {
        let s: Box<dyn SecretStore> = Box::new(MemoryStore::new());
        s.set(GOOGLE_SERVICE, "me", "token").unwrap();
        assert_eq!(
            s.get(GOOGLE_SERVICE, "me").unwrap().as_deref(),
            Some("token")
        );
    }

    #[test]
    fn keychain_errors_have_a_message_for_the_user() {
        use keyring::v1::Error;
        let none = keychain_error(&Error::NoDefaultStore);
        assert!(none.0.contains("キーチェーン"));
        let bad = keychain_error(&Error::Invalid("service".into(), "empty".into()));
        assert!(bad.0.starts_with("キーチェーンを使えません"));
        assert!(bad.0.contains("service"));
    }

    /// Needs a real keychain (and may ask the user to unlock it): run by hand with
    /// `cargo test -- --ignored keyring_store`.
    #[test]
    #[ignore = "uses the OS keychain"]
    fn keyring_store_round_trips() {
        let s = KeyringStore;
        let service = "app.powertodo.test";
        let account = "round-trip";
        s.delete(service, account).unwrap();
        assert_eq!(s.get(service, account).unwrap(), None);
        s.set(service, account, "秘密").unwrap();
        assert_eq!(s.get(service, account).unwrap().as_deref(), Some("秘密"));
        s.delete(service, account).unwrap();
        assert_eq!(s.get(service, account).unwrap(), None);
    }
}
