//! Google Calendar import (spec 2026-11-27): read-only. The events are Google's, kept per device in
//! `calendar.json` (accounts and the last fetch) and shown next to the tasks; they never enter an xlsx.
//!
//! `model` and `parse` are pure; `file` is the device's file; `http` talks to Google.

pub mod file;
pub mod http;
pub mod model;
pub mod parse;

pub use model::{CalEvent, CalendarInfo};
