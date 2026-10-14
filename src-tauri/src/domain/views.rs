//! Cross-project views (今日 / 近日 / ラベル詳細). Pure: they take every loaded task and return
//! the ones to show, in display order. No I/O, no clock (the caller passes `today`).

use std::collections::BTreeMap;

use chrono::{Days, NaiveDate};
use serde::Serialize;

use super::model::{Task, serde_date};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayView {
    pub overdue: Vec<Task>,
    pub today: Vec<Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayGroup {
    #[serde(with = "serde_date")]
    pub date: NaiveDate,
    pub tasks: Vec<Task>,
}

/// Unfinished and not a subtask: what the cross-project lists show (仕様 §3.1, §3.2).
fn open_top_level(t: &Task) -> bool {
    t.parent_no.is_none() && t.progress < 100
}

/// Due date (None last), then priority (1 first), then No.
fn by_due_priority_no(a: &Task, b: &Task) -> std::cmp::Ordering {
    let key = |t: &Task| (t.due.is_none(), t.due, u8::from(t.priority), t.no);
    key(a).cmp(&key(b))
}

fn by_priority_no(a: &Task, b: &Task) -> std::cmp::Ordering {
    (u8::from(a.priority), a.no).cmp(&(u8::from(b.priority), b.no))
}

pub fn today_view(tasks: &[Task], today: NaiveDate) -> TodayView {
    let mut overdue: Vec<Task> = tasks
        .iter()
        .filter(|t| open_top_level(t) && t.due.is_some_and(|d| d < today))
        .cloned()
        .collect();
    overdue.sort_by(by_due_priority_no);
    let mut todays: Vec<Task> = tasks
        .iter()
        .filter(|t| open_top_level(t) && t.due == Some(today))
        .cloned()
        .collect();
    todays.sort_by(by_priority_no);
    TodayView {
        overdue,
        today: todays,
    }
}

pub fn today_count(tasks: &[Task], today: NaiveDate) -> u32 {
    tasks
        .iter()
        .filter(|t| open_top_level(t) && t.due.is_some_and(|d| d <= today))
        .count() as u32
}

/// `days` groups starting at `from`; days without tasks are included (the view shows an add row).
pub fn upcoming(tasks: &[Task], from: NaiveDate, days: u32) -> Vec<DayGroup> {
    (0..days)
        .filter_map(|i| from.checked_add_days(Days::new(i as u64)))
        .map(|date| {
            let mut day: Vec<Task> = tasks
                .iter()
                .filter(|t| open_top_level(t) && t.due == Some(date))
                .cloned()
                .collect();
            day.sort_by(by_priority_no);
            DayGroup { date, tasks: day }
        })
        .collect()
}

/// Every unfinished task (subtasks too, flat) carrying `label`.
pub fn label_tasks(tasks: &[Task], label: &str) -> Vec<Task> {
    let mut out: Vec<Task> = tasks
        .iter()
        .filter(|t| t.progress < 100 && t.labels.iter().any(|l| l == label))
        .cloned()
        .collect();
    out.sort_by(by_due_priority_no);
    out
}

/// Unfinished tasks per label name (subtasks included).
pub fn label_counts(tasks: &[Task]) -> BTreeMap<String, u32> {
    let mut counts = BTreeMap::new();
    for t in tasks.iter().filter(|t| t.progress < 100) {
        for l in &t.labels {
            *counts.entry(l.clone()).or_insert(0) += 1;
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Priority;
    use chrono::NaiveDateTime;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn task(
        no: u32,
        project: &str,
        due: Option<&str>,
        priority: u8,
        progress: u8,
        parent: Option<u32>,
    ) -> Task {
        Task {
            no,
            project: project.into(),
            category: None,
            title: format!("t{no}"),
            assignee: String::new(),
            priority: Priority(priority),
            progress,
            start: None,
            due: due.map(d),
            due_time: None,
            days: None,
            note: None,
            parent_no: parent,
            labels: vec![],
            rrule: None,
            reminders: vec![],
            order: 0,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    #[test]
    fn today_splits_overdue_and_today_and_sorts() {
        let tasks = vec![
            task(1, "a", Some("2026-10-13"), 4, 0, None), // today, p4
            task(2, "a", Some("2026-10-13"), 1, 0, None), // today, p1 -> first in today
            task(3, "b", Some("2026-10-10"), 3, 0, None), // overdue
            task(4, "b", Some("2026-10-01"), 4, 0, None), // overdue, oldest -> first
            task(5, "b", Some("2026-10-10"), 1, 0, None), // overdue same day, p1 before p3
            task(6, "a", Some("2026-10-13"), 1, 100, None), // done: hidden
            task(7, "a", Some("2026-10-13"), 1, 0, Some(1)), // subtask: hidden
            task(8, "a", Some("2026-10-14"), 1, 0, None), // tomorrow: hidden
            task(9, "a", None, 1, 0, None),               // no due: hidden
        ];
        let v = today_view(&tasks, d("2026-10-13"));
        assert_eq!(
            v.overdue.iter().map(|t| t.no).collect::<Vec<_>>(),
            vec![4, 5, 3]
        );
        assert_eq!(v.today.iter().map(|t| t.no).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(today_count(&tasks, d("2026-10-13")), 5);
    }

    #[test]
    fn upcoming_groups_every_day_even_empty_and_excludes_overdue() {
        let tasks = vec![
            task(1, "a", Some("2026-10-13"), 4, 0, None),
            task(2, "a", Some("2026-10-15"), 1, 0, None),
            task(3, "a", Some("2026-10-15"), 3, 0, None),
            task(4, "a", Some("2026-10-12"), 1, 0, None), // overdue: not shown
            task(5, "a", Some("2026-10-20"), 1, 0, None), // outside 7 days
        ];
        let g = upcoming(&tasks, d("2026-10-13"), 7);
        assert_eq!(g.len(), 7);
        assert_eq!(g[0].date, d("2026-10-13"));
        assert_eq!(g[0].tasks.iter().map(|t| t.no).collect::<Vec<_>>(), vec![1]);
        assert!(g[1].tasks.is_empty());
        assert_eq!(
            g[2].tasks.iter().map(|t| t.no).collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert_eq!(g[6].date, d("2026-10-19"));
        assert!(
            g.iter()
                .all(|day| day.tasks.iter().all(|t| t.no != 4 && t.no != 5))
        );
    }

    #[test]
    fn label_tasks_are_flat_and_sorted_by_due_then_priority() {
        let mut a = task(1, "a", None, 2, 0, None);
        a.labels = vec!["食品".into()];
        let mut b = task(2, "b", Some("2026-10-20"), 4, 0, Some(1));
        b.labels = vec!["食品".into()]; // subtask: included
        let mut c = task(3, "b", Some("2026-10-15"), 4, 0, None);
        c.labels = vec!["食品".into(), "急ぎ".into()];
        let mut done = task(4, "b", Some("2026-10-15"), 4, 100, None);
        done.labels = vec!["食品".into()];
        let other = task(5, "b", Some("2026-10-15"), 4, 0, None);
        let tasks = vec![a, b, c, done, other];
        let got = label_tasks(&tasks, "食品");
        assert_eq!(got.iter().map(|t| t.no).collect::<Vec<_>>(), vec![3, 2, 1]);
        let counts = label_counts(&tasks);
        assert_eq!(counts["食品"], 3);
        assert_eq!(counts["急ぎ"], 1);
    }
}
