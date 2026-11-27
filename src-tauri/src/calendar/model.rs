use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::domain::model::serde_date;

/// One calendar of an account (`calendarList`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub name: String,
    /// `#rrggbb` as Google gives it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub primary: bool,
}

/// One day of an event. A multi-day event is one `CalEvent` per day it covers, so a list can group by `date`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    /// Google's event id (the same on each day of a multi-day event).
    pub id: String,
    pub title: String,
    #[serde(with = "serde_date")]
    pub date: NaiveDate,
    /// `HH:MM` in the device's time zone; `None` for an all-day event (and on the later days of a timed one).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    pub all_day: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}
