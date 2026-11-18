//! Cross-project views (今日 / 近日 / ラベル詳細). Pure: they take every loaded task and return
//! the ones to show, in display order. No I/O, no clock (the caller passes `today`).

use std::collections::BTreeMap;

use chrono::{Days, NaiveDate};
use serde::Serialize;

use super::model::{TODAY_ORDER, Task, serde_date, today_rank};

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

/// For each task (same index): is it a "visible open row"? Open, and every ancestor (within the
/// same project) exists and is open. A subtask whose parent is finished or missing is hidden in
/// every list, so it is not counted or shown anywhere (仕様 2026-11-18 §2).
pub fn visible_open(tasks: &[Task]) -> Vec<bool> {
    let index: std::collections::HashMap<(&str, u32), usize> = tasks
        .iter()
        .enumerate()
        .map(|(i, t)| ((t.project.as_str(), t.no), i))
        .collect();
    tasks
        .iter()
        .map(|t| {
            let mut cur = t;
            // The step cap guards against a parent cycle in a hand-edited book.
            for _ in 0..=tasks.len() {
                if cur.progress >= 100 {
                    return false;
                }
                match cur.parent_no {
                    None => return true,
                    Some(p) => match index.get(&(cur.project.as_str(), p)) {
                        Some(&i) => cur = &tasks[i],
                        None => return false,
                    },
                }
            }
            false
        })
        .collect()
}

/// The visible open rows of `tasks`, in their given order.
pub fn visible_open_rows(tasks: &[Task]) -> impl Iterator<Item = &Task> {
    let vis = visible_open(tasks);
    tasks.iter().zip(vis).filter(|(_, v)| *v).map(|(t, _)| t)
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
    let mut overdue: Vec<Task> = visible_open_rows(tasks)
        .filter(|t| t.due.is_some_and(|d| d < today))
        .cloned()
        .collect();
    overdue.sort_by(by_due_priority_no);
    let mut todays: Vec<Task> = visible_open_rows(tasks)
        .filter(|t| t.due == Some(today))
        .cloned()
        .collect();
    todays.sort_by(|a, b| {
        let ra = today_rank(a.extra.get(TODAY_ORDER), today);
        let rb = today_rank(b.extra.get(TODAY_ORDER), today);
        match (ra, rb) {
            (Some(x), Some(y)) => x.cmp(&y).then_with(|| by_priority_no(a, b)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => by_priority_no(a, b),
        }
    });
    TodayView {
        overdue,
        today: todays,
    }
}

pub fn today_count(tasks: &[Task], today: NaiveDate) -> u32 {
    visible_open_rows(tasks)
        .filter(|t| t.due.is_some_and(|d| d <= today))
        .count() as u32
}

/// `days` groups starting at `from`; days without tasks are included (the view shows an add row).
pub fn upcoming(tasks: &[Task], from: NaiveDate, days: u32) -> Vec<DayGroup> {
    let rows: Vec<&Task> = visible_open_rows(tasks).collect();
    (0..days)
        .filter_map(|i| from.checked_add_days(Days::new(i as u64)))
        .map(|date| {
            let mut day: Vec<Task> = rows
                .iter()
                .filter(|t| t.due == Some(date))
                .map(|t| (*t).clone())
                .collect();
            day.sort_by(by_priority_no);
            DayGroup { date, tasks: day }
        })
        .collect()
}

/// Every visible open row (subtasks too, flat) carrying `label`.
pub fn label_tasks(tasks: &[Task], label: &str) -> Vec<Task> {
    let mut out: Vec<Task> = visible_open_rows(tasks)
        .filter(|t| t.labels.iter().any(|l| l == label))
        .cloned()
        .collect();
    out.sort_by(by_due_priority_no);
    out
}

/// Visible open rows per label name (subtasks included).
pub fn label_counts(tasks: &[Task]) -> BTreeMap<String, u32> {
    let mut counts = BTreeMap::new();
    for t in visible_open_rows(tasks) {
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
            rrule_label: None,
            reminders: vec![],
            order: 0,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    fn task_due(no: u32, due: NaiveDate) -> Task {
        task(
            no,
            "a",
            Some(&due.format("%Y-%m-%d").to_string()),
            4,
            0,
            None,
        )
    }

    #[test]
    fn today_view_uses_todays_order_first() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 25).unwrap();
        let mut a = task_due(1, today);
        let mut b = task_due(2, today);
        let c = task_due(3, today);
        a.extra.insert(TODAY_ORDER.into(), "2026-10-25:2".into());
        b.extra.insert(TODAY_ORDER.into(), "2026-10-25:1".into());
        let v = today_view(&[a, b, c], today);
        let nos: Vec<u32> = v.today.iter().map(|t| t.no).collect();
        assert_eq!(nos, [2, 1, 3]);
    }

    #[test]
    fn today_view_ignores_an_old_today_order() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 25).unwrap();
        let a = task_due(1, today);
        let mut b = task_due(2, today);
        b.extra.insert(TODAY_ORDER.into(), "2026-10-24:1".into());
        let v = today_view(&[a, b], today);
        let nos: Vec<u32> = v.today.iter().map(|t| t.no).collect();
        assert_eq!(nos, [1, 2]);
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
            task(7, "a", Some("2026-10-13"), 1, 0, Some(1)), // open subtask of an open parent: shown
            task(8, "a", Some("2026-10-14"), 1, 0, None), // tomorrow: hidden
            task(9, "a", None, 1, 0, None),               // no due: hidden
        ];
        let v = today_view(&tasks, d("2026-10-13"));
        assert_eq!(
            v.overdue.iter().map(|t| t.no).collect::<Vec<_>>(),
            vec![4, 5, 3]
        );
        assert_eq!(v.today.iter().map(|t| t.no).collect::<Vec<_>>(), vec![2, 7, 1]);
        assert_eq!(today_count(&tasks, d("2026-10-13")), 6);
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
        let mut b = task(2, "a", Some("2026-10-20"), 4, 0, Some(1));
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

    #[test]
    fn visible_open_needs_every_ancestor_open_and_present() {
        let tasks = vec![
            task(1, "a", None, 4, 0, None),       // open top
            task(2, "a", None, 4, 100, None),     // done top
            task(3, "a", None, 4, 0, Some(1)),    // under open: visible
            task(4, "a", None, 4, 0, Some(2)),    // under done: hidden
            task(5, "a", None, 4, 0, Some(4)),    // grandchild under hidden: hidden
            task(6, "a", None, 4, 0, Some(3)),    // grandchild under open chain: visible
            task(7, "a", None, 4, 0, Some(99)),   // missing parent: hidden
            task(1, "b", None, 4, 100, None),     // same No. in another project: done
            task(8, "b", None, 4, 0, Some(1)),    // parent is b#1 (done), not a#1: hidden
        ];
        assert_eq!(
            visible_open(&tasks),
            [true, false, true, false, false, true, false, false, false]
        );
    }

    #[test]
    fn today_and_upcoming_include_due_subtasks_but_not_under_done_parents() {
        let t = d("2026-10-13");
        let tasks = vec![
            task(1, "a", None, 4, 0, None),
            task(2, "a", Some("2026-10-13"), 4, 0, Some(1)),
            task(3, "a", Some("2026-10-14"), 4, 0, Some(1)),
            task(4, "a", None, 4, 100, None),
            task(5, "a", Some("2026-10-13"), 4, 0, Some(4)),
            task(6, "a", Some("2026-10-14"), 4, 0, Some(4)),
        ];
        let v = today_view(&tasks, t);
        assert_eq!(v.today.iter().map(|x| x.no).collect::<Vec<_>>(), vec![2]);
        assert_eq!(today_count(&tasks, t), 1);
        let g = upcoming(&tasks, t, 2);
        assert_eq!(g[1].tasks.iter().map(|x| x.no).collect::<Vec<_>>(), vec![3]);
    }
}
