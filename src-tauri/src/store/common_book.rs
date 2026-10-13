//! Common workbook (`_PowerToDo.xlsx`): projects, labels, filters (header only for now),
//! holidays and settings.
//!
//! | sheet | columns |
//! | --- | --- |
//! | プロジェクト | 名前 / 色 / 並び順 / お気に入り / 受信トレイ |
//! | ラベル | 名前 / 色 / 並び順 |
//! | フィルター | 名前 / クエリ / 並び順 (written empty; not read yet) |
//! | 祝日 | 日付 / 名称 |
//! | 設定 | キー / 値 (表示名, 週の開始, タイムゾーン) |
//!
//! Colors are the CSS variable strings the UI uses (e.g. `var(--color-priority-2)`); お気に入り
//! and 受信トレイ are TRUE / FALSE cells. Sheets and columns are located by name, so a missing
//! sheet reads as empty. Only the project named 受信トレイ is the inbox, whatever its cell says.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use calamine::{Data, Reader, Xlsx, open_workbook};
use chrono::NaiveDate;
use rust_xlsxwriter::{Workbook, Worksheet, XlsxError};
use serde::{Deserialize, Serialize};

use super::cells;
use super::project_book::{persist_workbook, xlsx_err, xlsx_write_err};
use super::style;
use crate::domain::{INBOX, Label, Project};
use crate::error::AppResult;

pub const COMMON_FILE: &str = "_PowerToDo.xlsx";

const SHEET_PROJECTS: &str = "プロジェクト";
const SHEET_LABELS: &str = "ラベル";
const SHEET_FILTERS: &str = "フィルター";
const SHEET_HOLIDAYS: &str = "祝日";
const SHEET_SETTINGS: &str = "設定";

const KEY_DISPLAY_NAME: &str = "表示名";
const KEY_WEEK_START: &str = "週の開始";
const KEY_TIMEZONE: &str = "タイムゾーン";

const DEFAULT_COLOR: &str = "var(--color-text-muted)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub display_name: String,
    /// `"mon"` or `"sun"`.
    pub week_start: String,
    /// IANA name, or `"local"` (the OS time zone).
    pub timezone: String,
}

impl Settings {
    /// Display name = OS user name when known (`USER` / `USERNAME`), else 自分.
    pub fn default_for_user() -> Self {
        let name = ["USER", "USERNAME"]
            .iter()
            .filter_map(|k| std::env::var(k).ok())
            .map(|v| v.trim().to_string())
            .find(|v| !v.is_empty())
            .unwrap_or_else(|| "自分".to_string());
        Settings {
            display_name: name,
            week_start: "mon".into(),
            timezone: "local".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommonBook {
    pub projects: Vec<Project>,
    pub labels: Vec<Label>,
    /// Sorted, no duplicates.
    pub holidays: Vec<NaiveDate>,
    /// 祝日 の 名称 column, kept so editing the sheet by hand does not lose it.
    pub holiday_names: BTreeMap<NaiveDate, String>,
    pub settings: Settings,
}

impl CommonBook {
    /// What a fresh data folder starts with: just the inbox.
    pub fn new_default() -> Self {
        CommonBook {
            projects: vec![Project {
                name: INBOX.into(),
                color: DEFAULT_COLOR.into(),
                order: 0,
                favorite: false,
                inbox: true,
            }],
            labels: Vec::new(),
            holidays: Vec::new(),
            holiday_names: BTreeMap::new(),
            settings: Settings::default_for_user(),
        }
    }
}

/// Rows of `sheet` below the header row, with cells arranged in the order of `headers`
/// (`Empty` where the sheet has no such column). A missing sheet or a sheet without the
/// first header yields no rows.
fn sheet_rows(
    wb: &mut Xlsx<std::io::BufReader<std::fs::File>>,
    sheet: &str,
    headers: &[&str],
) -> AppResult<Vec<Vec<Data>>> {
    let range = match wb.worksheet_range(sheet) {
        Ok(r) => r,
        Err(calamine::XlsxError::WorksheetNotFound(_)) => return Ok(Vec::new()),
        Err(e) => return Err(xlsx_err(e)),
    };
    let mut rows = range.rows();
    let Some(header_row) = rows.next() else {
        return Ok(Vec::new());
    };
    let cols: Vec<Option<usize>> = headers
        .iter()
        .map(|h| header_row.iter().position(|c| cells::text(c).trim() == *h))
        .collect();
    if cols[0].is_none() {
        return Ok(Vec::new());
    }
    Ok(rows
        .map(|r| {
            cols.iter()
                .map(|c| c.and_then(|c| r.get(c)).cloned().unwrap_or(Data::Empty))
                .collect()
        })
        .collect())
}

fn truthy(d: &Data) -> bool {
    match d {
        Data::Bool(b) => *b,
        Data::Int(i) => *i != 0,
        Data::Float(f) => *f != 0.0,
        Data::String(s) => matches!(
            s.trim().to_ascii_uppercase().as_str(),
            "TRUE" | "1" | "YES" | "はい"
        ),
        _ => false,
    }
}

fn order_or(d: &Data, fallback: usize) -> u32 {
    match cells::integer(d) {
        Ok(Some(n)) if (0..=i64::from(u32::MAX)).contains(&n) => n as u32,
        _ => fallback as u32,
    }
}

fn color_or_default(d: &Data) -> String {
    let c = cells::text(d).trim().to_string();
    if c.is_empty() {
        DEFAULT_COLOR.into()
    } else {
        c
    }
}

/// A holiday cell: a real date, or ISO text typed into a General cell.
fn date_of(d: &Data) -> Option<NaiveDate> {
    if let Ok(Some(dt)) = cells::datetime(d) {
        return Some(dt.date());
    }
    NaiveDate::parse_from_str(cells::text(d).trim(), "%Y-%m-%d").ok()
}

/// Reads the common workbook. Not an xlsx -> `Corrupt`; no such file -> `Io`.
pub fn read_common_book(path: &Path) -> AppResult<CommonBook> {
    let mut wb: Xlsx<_> = open_workbook(path).map_err(xlsx_err)?;

    let mut projects: Vec<Project> = Vec::new();
    let mut seen = HashSet::new();
    let rows = sheet_rows(
        &mut wb,
        SHEET_PROJECTS,
        &["名前", "色", "並び順", "お気に入り", "受信トレイ"],
    )?;
    for (i, r) in rows.iter().enumerate() {
        let name = cells::text(&r[0]).trim().to_string();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        projects.push(Project {
            inbox: name == INBOX,
            name,
            color: color_or_default(&r[1]),
            order: order_or(&r[2], i),
            favorite: truthy(&r[3]),
        });
    }

    let mut labels: Vec<Label> = Vec::new();
    let mut seen = HashSet::new();
    let rows = sheet_rows(&mut wb, SHEET_LABELS, &["名前", "色", "並び順"])?;
    for (i, r) in rows.iter().enumerate() {
        let name = cells::text(&r[0]).trim().to_string();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        labels.push(Label {
            name,
            color: color_or_default(&r[1]),
            order: order_or(&r[2], i),
        });
    }

    let mut holidays: Vec<NaiveDate> = Vec::new();
    let mut holiday_names = BTreeMap::new();
    for r in sheet_rows(&mut wb, SHEET_HOLIDAYS, &["日付", "名称"])? {
        let Some(date) = date_of(&r[0]) else { continue };
        holidays.push(date);
        let label = cells::text(&r[1]).trim().to_string();
        if !label.is_empty() {
            holiday_names.insert(date, label);
        }
    }
    holidays.sort();
    holidays.dedup();

    let mut settings = Settings::default_for_user();
    for r in sheet_rows(&mut wb, SHEET_SETTINGS, &["キー", "値"])? {
        let value = cells::text(&r[1]).trim().to_string();
        if value.is_empty() {
            continue;
        }
        match cells::text(&r[0]).trim() {
            KEY_DISPLAY_NAME => settings.display_name = value,
            KEY_WEEK_START if matches!(value.as_str(), "mon" | "sun") => {
                settings.week_start = value;
            }
            KEY_TIMEZONE => settings.timezone = value,
            _ => {}
        }
    }

    Ok(CommonBook {
        projects,
        labels,
        holidays,
        holiday_names,
        settings,
    })
}

fn write_header(ws: &mut Worksheet, name: &str, headers: &[&str]) -> Result<(), XlsxError> {
    ws.set_name(name)?;
    let fmt = style::header_format();
    for (c, h) in headers.iter().enumerate() {
        ws.write_string_with_format(0, c as u16, *h, &fmt)?;
        ws.set_column_width(c as u16, 16)?;
    }
    ws.set_freeze_panes(1, 0)?;
    Ok(())
}

fn build_workbook(book: &CommonBook) -> Result<Workbook, XlsxError> {
    let mut wb = Workbook::new();

    let ws = wb.add_worksheet();
    write_header(
        ws,
        SHEET_PROJECTS,
        &["名前", "色", "並び順", "お気に入り", "受信トレイ"],
    )?;
    ws.set_column_width(0, 24)?;
    ws.set_column_width(1, 28)?;
    for (i, p) in book.projects.iter().enumerate() {
        let r = i as u32 + 1;
        ws.write_string(r, 0, &p.name)?;
        ws.write_string(r, 1, &p.color)?;
        ws.write_number(r, 2, p.order)?;
        ws.write_boolean(r, 3, p.favorite)?;
        ws.write_boolean(r, 4, p.name == INBOX)?;
    }

    let ws = wb.add_worksheet();
    write_header(ws, SHEET_LABELS, &["名前", "色", "並び順"])?;
    ws.set_column_width(0, 24)?;
    ws.set_column_width(1, 28)?;
    for (i, l) in book.labels.iter().enumerate() {
        let r = i as u32 + 1;
        ws.write_string(r, 0, &l.name)?;
        ws.write_string(r, 1, &l.color)?;
        ws.write_number(r, 2, l.order)?;
    }

    write_header(
        wb.add_worksheet(),
        SHEET_FILTERS,
        &["名前", "クエリ", "並び順"],
    )?;

    let ws = wb.add_worksheet();
    write_header(ws, SHEET_HOLIDAYS, &["日付", "名称"])?;
    let date_fmt = style::date_format();
    let mut days = book.holidays.clone();
    days.sort();
    days.dedup();
    for (i, d) in days.iter().enumerate() {
        let r = i as u32 + 1;
        ws.write_datetime_with_format(r, 0, *d, &date_fmt)?;
        if let Some(n) = book.holiday_names.get(d) {
            ws.write_string(r, 1, n)?;
        }
    }

    let ws = wb.add_worksheet();
    write_header(ws, SHEET_SETTINGS, &["キー", "値"])?;
    let s = &book.settings;
    for (i, (k, v)) in [
        (KEY_DISPLAY_NAME, &s.display_name),
        (KEY_WEEK_START, &s.week_start),
        (KEY_TIMEZONE, &s.timezone),
    ]
    .iter()
    .enumerate()
    {
        ws.write_string(i as u32 + 1, 0, *k)?;
        ws.write_string(i as u32 + 1, 1, v.as_str())?;
    }
    Ok(wb)
}

/// Writes the whole workbook to a temp file, then renames it over `path`.
pub fn write_common_book(path: &Path, book: &CommonBook) -> AppResult<()> {
    let mut wb = build_workbook(book).map_err(xlsx_write_err)?;
    persist_workbook(&mut wb, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::INBOX;
    use crate::error::AppError;
    use calamine::{Reader, Xlsx, open_workbook};
    use rust_xlsxwriter::Workbook;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn project(name: &str, order: u32, favorite: bool) -> Project {
        Project {
            name: name.into(),
            color: "var(--color-priority-2)".into(),
            order,
            favorite,
            inbox: name == INBOX,
        }
    }

    fn sample() -> CommonBook {
        CommonBook {
            projects: vec![
                project(INBOX, 0, false),
                project("仕事", 1, true),
                project("家", 2, false),
            ],
            labels: vec![
                Label {
                    name: "急ぎ".into(),
                    color: "var(--color-priority-1)".into(),
                    order: 0,
                },
                Label {
                    name: "会議".into(),
                    color: "var(--color-priority-3)".into(),
                    order: 1,
                },
            ],
            holidays: vec![d(2026, 1, 1), d(2026, 2, 11)],
            holiday_names: BTreeMap::from([(d(2026, 1, 1), "元日".to_string())]),
            settings: Settings {
                display_name: "はなこ".into(),
                week_start: "sun".into(),
                timezone: "Asia/Tokyo".into(),
            },
        }
    }

    #[test]
    fn common_book_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        let b = sample();
        write_common_book(&p, &b).unwrap();
        assert_eq!(read_common_book(&p).unwrap(), b);

        // Sheet layout: all five sheets exist, in this order.
        let wb: Xlsx<_> = open_workbook(&p).unwrap();
        assert_eq!(
            wb.sheet_names(),
            vec!["プロジェクト", "ラベル", "フィルター", "祝日", "設定"]
        );
    }

    #[test]
    fn default_book_has_inbox_and_defaults() {
        let b = CommonBook::new_default();
        assert_eq!(b.projects.len(), 1);
        let inbox = &b.projects[0];
        assert_eq!(inbox.name, INBOX);
        assert!(inbox.inbox);
        assert_eq!(inbox.color, "var(--color-text-muted)");
        assert_eq!(inbox.order, 0);
        assert!(b.labels.is_empty() && b.holidays.is_empty());
        assert_eq!(b.settings.week_start, "mon");
        assert_eq!(b.settings.timezone, "local");
        assert!(!b.settings.display_name.is_empty());

        // Default book survives a round trip.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        write_common_book(&p, &b).unwrap();
        assert_eq!(read_common_book(&p).unwrap(), b);
    }

    #[test]
    fn missing_sheets_use_defaults_and_inbox_follows_the_name() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.set_name("プロジェクト").unwrap();
        for (c, h) in ["名前", "色", "並び順", "お気に入り", "受信トレイ"]
            .iter()
            .enumerate()
        {
            ws.write_string(0, c as u16, *h).unwrap();
        }
        // "仕事" claims to be the inbox; a blank-named row is skipped; a duplicate is ignored.
        ws.write_string(1, 0, "仕事").unwrap();
        ws.write_boolean(1, 4, true).unwrap();
        ws.write_string(2, 0, "").unwrap();
        ws.write_string(3, 0, "仕事").unwrap();
        ws.write_string(4, 0, INBOX).unwrap();
        wb.save(&p).unwrap();

        let b = read_common_book(&p).unwrap();
        assert_eq!(b.projects.len(), 2);
        let work = &b.projects[0];
        assert!(
            !work.inbox,
            "only the project named 受信トレイ is the inbox"
        );
        assert_eq!(work.color, "var(--color-text-muted)");
        assert_eq!(work.order, 0, "blank order falls back to the row position");
        assert!(b.projects[1].inbox);
        assert!(b.labels.is_empty() && b.holidays.is_empty());
        assert_eq!(b.settings.week_start, "mon");
    }

    #[test]
    fn non_xlsx_is_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        std::fs::write(&p, "not a workbook").unwrap();
        assert!(matches!(
            read_common_book(&p),
            Err(AppError::Corrupt { .. })
        ));
        assert!(matches!(
            read_common_book(&dir.path().join("none.xlsx")),
            Err(AppError::Io { .. })
        ));
    }
}
