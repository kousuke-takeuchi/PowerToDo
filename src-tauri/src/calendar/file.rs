//! `<app_data_dir>/calendar.json`: per device, never synced. The accounts that are logged in (their tokens are in
//! the keychain) and the last fetch of each calendar.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model::CalEvent;
use crate::error::AppResult;
use crate::store::paths::write_atomic;

pub const FILE: &str = "calendar.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFile {
    /// E-mail addresses of the logged-in accounts, in the order they were added.
    #[serde(default)]
    pub accounts: Vec<String>,
    /// Keyed by `link_key(account, calendar)`.
    #[serde(default)]
    pub cache: BTreeMap<String, CacheEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    /// Unix seconds of the fetch.
    pub fetched_at: i64,
    pub events: Vec<CalEvent>,
}

/// The cache key of one calendar of one account.
pub fn link_key(account: &str, calendar_id: &str) -> String {
    format!("{account}|{calendar_id}")
}

pub fn path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(FILE)
}

impl CalendarFile {
    /// A missing or unreadable file is an empty one (the accounts are asked for again; nothing is lost but the cache).
    pub fn load(app_data_dir: &Path) -> Self {
        std::fs::read(path(app_data_dir)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, app_data_dir: &Path) -> AppResult<()> {
        write_atomic(&path(app_data_dir), &serde_json::to_vec_pretty(self).unwrap_or_default())
    }

    pub fn add_account(&mut self, email: &str) {
        if !self.accounts.iter().any(|a| a == email) {
            self.accounts.push(email.to_string());
        }
    }

    /// Drops the account and everything fetched through it.
    pub fn remove_account(&mut self, email: &str) {
        self.accounts.retain(|a| a != email);
        let prefix = format!("{email}|");
        self.cache.retain(|k, _| !k.starts_with(&prefix));
    }

    pub fn put(&mut self, account: &str, calendar_id: &str, now: i64, events: Vec<CalEvent>) {
        self.cache.insert(link_key(account, calendar_id), CacheEntry { fetched_at: now, events });
    }

    pub fn get(&self, account: &str, calendar_id: &str) -> Option<&CacheEntry> {
        self.cache.get(&link_key(account, calendar_id))
    }
}

/// Fetched less than this ago: not fetched again (spec 2026-11-27 §3).
pub const FRESH_SECONDS: i64 = 300;

pub fn is_fresh(entry: Option<&CacheEntry>, now: i64) -> bool {
    entry.is_some_and(|e| now - e.fetched_at < FRESH_SECONDS && now >= e.fetched_at)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_are_unique_and_removing_one_drops_its_cache() {
        let mut f = CalendarFile::default();
        f.add_account("a@x.com");
        f.add_account("a@x.com");
        f.add_account("b@x.com");
        assert_eq!(f.accounts, ["a@x.com", "b@x.com"]);
        f.put("a@x.com", "primary", 10, vec![]);
        f.put("b@x.com", "primary", 10, vec![]);
        f.remove_account("a@x.com");
        assert_eq!(f.accounts, ["b@x.com"]);
        assert!(f.get("a@x.com", "primary").is_none() && f.get("b@x.com", "primary").is_some());
    }

    #[test]
    fn the_file_round_trips_and_an_unreadable_one_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(CalendarFile::load(dir.path()), CalendarFile::default());
        let mut f = CalendarFile::default();
        f.add_account("a@x.com");
        f.put("a@x.com", "c", 5, vec![]);
        f.save(dir.path()).unwrap();
        assert_eq!(CalendarFile::load(dir.path()), f);
        std::fs::write(path(dir.path()), b"not json").unwrap();
        assert_eq!(CalendarFile::load(dir.path()), CalendarFile::default());
    }

    #[test]
    fn a_fetch_is_fresh_for_five_minutes() {
        let e = CacheEntry { fetched_at: 1000, events: vec![] };
        assert!(is_fresh(Some(&e), 1299));
        assert!(!is_fresh(Some(&e), 1300));
        assert!(!is_fresh(None, 1000));
        assert!(!is_fresh(Some(&e), 999), "a clock that went back is not fresh");
    }
}
