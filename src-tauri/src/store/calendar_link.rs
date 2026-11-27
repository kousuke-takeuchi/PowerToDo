//! Spec 2026-11-27: which Google calendars a project shows, as `カレンダー:<project>` rows of the common book's
//! 設定 sheet (like the 表示 rows: they round-trip, sync per key, and an old build keeps what it does not know).
//! The value has one line per calendar, each `<e-mail>|<calendar id>|<color>|<name>` (several calendars, of several
//! accounts, may be shown in one project); the name comes last, so it may hold a `|`.

use std::collections::BTreeMap;

use super::project_store::{ProjectStore, invalid};
use crate::error::AppResult;

pub const PREFIX: &str = "カレンダー:";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarLink {
    /// The Google account the calendar belongs to.
    pub account: String,
    pub calendar_id: String,
    /// `#rrggbb`, or empty.
    pub color: String,
    pub name: String,
}

impl CalendarLink {
    pub fn encode(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.account, self.calendar_id, self.color, self.name
        )
    }

    pub fn decode(value: &str) -> Option<Self> {
        let mut p = value.splitn(4, '|');
        let (account, calendar_id) = (p.next()?, p.next()?);
        if account.is_empty() || calendar_id.is_empty() {
            return None;
        }
        Some(CalendarLink {
            account: account.into(),
            calendar_id: calendar_id.into(),
            color: p.next().unwrap_or("").into(),
            name: p.next().unwrap_or("").into(),
        })
    }
}

impl ProjectStore {
    /// Project name to its calendars, in the order chosen. A line that cannot be read is left out (it goes when the row is
    /// written again); a project with no readable line is left out.
    pub fn calendar_links(&self) -> BTreeMap<String, Vec<CalendarLink>> {
        self.common
            .extra_settings
            .iter()
            .filter_map(|(k, v)| {
                let project = k.strip_prefix(PREFIX)?.to_string();
                let links: Vec<CalendarLink> = v.lines().filter_map(CalendarLink::decode).collect();
                (!links.is_empty()).then_some((project, links))
            })
            .collect()
    }

    /// Sets the calendars of a project; an empty list takes them all off. The same calendar twice is kept once.
    pub fn set_calendar_links(&mut self, project: &str, links: &[CalendarLink]) -> AppResult<()> {
        if !self.common.projects.iter().any(|p| p.name == project) {
            return Err(invalid(format!("プロジェクトがありません: {project}")));
        }
        let key = format!("{PREFIX}{project}");
        let mut seen = std::collections::BTreeSet::new();
        let value = links
            .iter()
            .filter(|l| seen.insert((l.account.clone(), l.calendar_id.clone())))
            .map(CalendarLink::encode)
            .collect::<Vec<_>>()
            .join("\n");
        let rows = &mut self.common.extra_settings;
        match (rows.iter().position(|(k, _)| *k == key), value.is_empty()) {
            (Some(i), false) => rows[i].1 = value,
            (Some(i), true) => {
                rows.remove(i);
            }
            (None, false) => rows.push((key, value)),
            (None, true) => return Ok(()),
        }
        self.common_dirty = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use chrono::NaiveDateTime;

    use super::*;
    use crate::store::paths::Paths;

    fn open_at(dir: &std::path::Path) -> ProjectStore {
        let now = NaiveDateTime::parse_from_str("2026-10-14T09:30", "%Y-%m-%dT%H:%M").unwrap();
        let c = Arc::new(Mutex::new(now));
        ProjectStore::open(Paths::new(dir), move || *c.lock().unwrap(), true).unwrap()
    }

    fn link(account: &str) -> CalendarLink {
        CalendarLink {
            account: account.into(),
            calendar_id: "primary".into(),
            color: "#fff".into(),
            name: "予定".into(),
        }
    }

    #[test]
    fn a_link_is_set_replaced_removed_and_survives_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let mut s = open_at(&data);
        s.create_project("仕事", "var(--color-priority-2)").unwrap();
        s.set_calendar_links("仕事", &[link("a@x.com")]).unwrap();
        s.set_calendar_links("仕事", &[link("b@x.com")]).unwrap();
        s.save_common().unwrap();
        assert_eq!(
            open_at(&data).calendar_links()["仕事"][0].account,
            "b@x.com"
        );
        s.set_calendar_links("仕事", &[]).unwrap();
        assert!(s.calendar_links().is_empty());
        assert!(s.set_calendar_links("ない", &[link("a@x.com")]).is_err());
    }

    #[test]
    fn a_project_keeps_several_calendars_in_order_and_drops_a_repeat() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let mut s = open_at(&data);
        s.create_project("仕事", "var(--color-priority-2)").unwrap();
        let other = CalendarLink {
            calendar_id: "work".into(),
            name: "仕事 | 共有".into(),
            ..link("b@x.com")
        };
        s.set_calendar_links("仕事", &[link("a@x.com"), other.clone(), link("a@x.com")])
            .unwrap();
        s.save_common().unwrap();
        let got = open_at(&data).calendar_links().remove("仕事").unwrap();
        assert_eq!(got, [link("a@x.com"), other]);
    }

    #[test]
    fn an_unreadable_line_is_skipped_and_a_row_without_a_readable_line_is_left_out() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = open_at(&dir.path().join("data"));
        s.create_project("仕事", "var(--color-priority-2)").unwrap();
        s.set_calendar_links("仕事", &[link("a@x.com")]).unwrap();
        s.common
            .extra_settings
            .push(("カレンダー:仕事2".into(), "壊れた".into()));
        s.common
            .extra_settings
            .iter_mut()
            .find(|(k, _)| k == "カレンダー:仕事")
            .unwrap()
            .1
            .push_str("\nゴミ");
        let links = s.calendar_links();
        assert_eq!(links["仕事"].len(), 1);
        assert!(!links.contains_key("仕事2"));
    }

    #[test]
    fn the_link_follows_a_project_rename_and_goes_with_a_delete() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = open_at(&dir.path().join("data"));
        s.create_project("仕事", "var(--color-priority-2)").unwrap();
        s.set_calendar_links("仕事", &[link("a@x.com")]).unwrap();
        s.rename_project("仕事", "会社").unwrap();
        assert_eq!(s.calendar_links().keys().collect::<Vec<_>>(), ["会社"]);
        s.delete_project("会社").unwrap();
        assert!(s.calendar_links().is_empty());
    }

    #[test]
    fn a_link_round_trips_and_the_name_may_hold_a_bar() {
        let l = CalendarLink {
            account: "a@x.com".into(),
            calendar_id: "c@group.calendar.google.com".into(),
            color: "#16a765".into(),
            name: "仕事 | 共有".into(),
        };
        assert_eq!(CalendarLink::decode(&l.encode()), Some(l));
    }

    #[test]
    fn a_short_or_empty_value_is_not_a_link() {
        assert_eq!(CalendarLink::decode(""), None);
        assert_eq!(CalendarLink::decode("a@x.com"), None);
        assert_eq!(CalendarLink::decode("|id|#fff|n"), None);
        assert_eq!(
            CalendarLink::decode("a@x.com|id").map(|l| (l.color, l.name)),
            Some((String::new(), String::new()))
        );
    }
}
