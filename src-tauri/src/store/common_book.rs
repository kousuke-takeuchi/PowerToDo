//! Common workbook (`_PowerToDo.xlsx`): projects, labels, filters (header only for now),
//! holidays and settings.
//!
//! | sheet | columns |
//! | --- | --- |
//! | プロジェクト | 名前 / 色 / 並び順 / お気に入り / 受信トレイ |
//! | ラベル | 名前 / 色 / 並び順 |
//! | フィルター | 名前 / クエリ / 並び順 (written empty; not read yet) |
//! | 祝日 | 日付 / 名称 |
//! | 設定 | キー / 値 (表示名, 週の開始, タイムゾーン, 既定リマインダー, 時刻なしの通知時刻, 閉じたときトレイに残す, 通知) |
//!
//! Colors are the CSS variable strings the UI uses (e.g. `var(--color-priority-2)`); お気に入り
//! and 受信トレイ are TRUE / FALSE cells. Sheets and columns are located by name, so a missing
//! sheet reads as empty. Only the project named 受信トレイ is the inbox, whatever its cell says.
//!
//! What a round trip keeps beyond the modeled fields: extra columns on プロジェクト / ラベル
//! (as text, written after the known columns in their original order), 祝日 rows whose 日付
//! is not a date (cells as read, written after the dated rows), and 設定 rows with unknown
//! keys (key / value text). Not kept: sheets other than the five above, フィルター rows,
//! columns with a blank or repeated header, and formatting.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use calamine::{Data, Reader, Xlsx, open_workbook};
use chrono::{NaiveDate, NaiveTime};
use rust_xlsxwriter::{Workbook, Worksheet, XlsxError};
use serde::{Deserialize, Serialize};

use super::cells::{self, RawCell};
use super::project_book::{persist_workbook, write_raw, xlsx_err, xlsx_write_err};
use super::style;
use crate::domain::{INBOX, Label, Project, reminders};
use crate::error::AppResult;

pub const COMMON_FILE: &str = "_PowerToDo.xlsx";

const SHEET_PROJECTS: &str = "プロジェクト";
const SHEET_LABELS: &str = "ラベル";
const SHEET_FILTERS: &str = "フィルター";
const SHEET_HOLIDAYS: &str = "祝日";
const SHEET_SETTINGS: &str = "設定";

const PROJECT_HEADERS: &[&str] = &["名前", "色", "並び順", "お気に入り", "受信トレイ"];
const LABEL_HEADERS: &[&str] = &["名前", "色", "並び順"];
const HOLIDAY_HEADERS: &[&str] = &["日付", "名称"];
const SETTINGS_HEADERS: &[&str] = &["キー", "値"];

const KEY_DISPLAY_NAME: &str = "表示名";
const KEY_WEEK_START: &str = "週の開始";
const KEY_TIMEZONE: &str = "タイムゾーン";
const KEY_DEFAULT_REMINDER: &str = "既定リマインダー";
const KEY_NOTIFY_TIME: &str = "時刻なしの通知時刻";
const KEY_KEEP_IN_TRAY: &str = "閉じたときトレイに残す";
const KEY_NOTIFICATIONS: &str = "通知";
const NONE_WORD: &str = "なし";
const YES: &str = "はい";
const NO: &str = "いいえ";

const DEFAULT_COLOR: &str = "var(--color-text-muted)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub display_name: String,
    /// `"mon"` or `"sun"`.
    pub week_start: String,
    /// IANA name, or `"local"` (the OS time zone).
    pub timezone: String,
    /// Reminder code added to tasks that get a time; `None` = no default.
    pub default_reminder: Option<String>,
    /// When tasks with only a date notify.
    pub notify_time: NaiveTime,
    pub keep_in_tray: bool,
    pub notifications: bool,
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
            default_reminder: Some("-0m".into()),
            notify_time: NaiveTime::from_hms_opt(9, 0, 0).expect("valid time"),
            keep_in_tray: true,
            notifications: true,
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
    /// 祝日 rows whose 日付 is not a date, as read (日付, 名称); written back after the
    /// dated rows.
    pub unparsed_holidays: Vec<Vec<RawCell>>,
    pub settings: Settings,
    /// 設定 rows whose key this version does not know, in sheet order.
    pub extra_settings: Vec<(String, String)>,
    /// プロジェクト columns this version does not know, in sheet order.
    pub project_columns: Vec<String>,
    /// Per project (by name): values of `project_columns`, non-empty cells only.
    pub project_extra: BTreeMap<String, BTreeMap<String, String>>,
    /// ラベル columns this version does not know, in sheet order.
    pub label_columns: Vec<String>,
    /// Per label (by name): values of `label_columns`, non-empty cells only.
    pub label_extra: BTreeMap<String, BTreeMap<String, String>>,
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
            unparsed_holidays: Vec::new(),
            extra_settings: Vec::new(),
            project_columns: Vec::new(),
            project_extra: BTreeMap::new(),
            label_columns: Vec::new(),
            label_extra: BTreeMap::new(),
        }
    }
}

/// The rows of a sheet below its header row.
#[derive(Default)]
struct SheetRows {
    /// Header names of the columns not in the requested list, in sheet order (blank and
    /// repeated headers are skipped).
    extra_headers: Vec<String>,
    /// Per row: the cells of the requested headers in that order (`Empty` where the sheet
    /// has no such column), and the cells of `extra_headers`.
    rows: Vec<(Vec<Data>, Vec<Data>)>,
}

/// Reads `sheet` by header name. A missing sheet or a sheet without the first header yields
/// no rows.
fn sheet_rows(
    wb: &mut Xlsx<std::io::BufReader<std::fs::File>>,
    sheet: &str,
    headers: &[&str],
) -> AppResult<SheetRows> {
    let range = match wb.worksheet_range(sheet) {
        Ok(r) => r,
        Err(calamine::XlsxError::WorksheetNotFound(_)) => return Ok(SheetRows::default()),
        Err(e) => return Err(xlsx_err(e)),
    };
    let mut rows = range.rows();
    let Some(header_row) = rows.next() else {
        return Ok(SheetRows::default());
    };
    let names: Vec<String> = header_row
        .iter()
        .map(|c| cells::text(c).trim().to_string())
        .collect();
    let cols: Vec<Option<usize>> = headers
        .iter()
        .map(|h| names.iter().position(|n| n == h))
        .collect();
    if cols[0].is_none() {
        return Ok(SheetRows::default());
    }
    let mut extra_cols: Vec<usize> = Vec::new();
    let mut extra_headers: Vec<String> = Vec::new();
    for (i, n) in names.iter().enumerate() {
        if n.is_empty() || headers.contains(&n.as_str()) || extra_headers.contains(n) {
            continue;
        }
        extra_cols.push(i);
        extra_headers.push(n.clone());
    }
    let pick =
        |r: &[Data], c: Option<usize>| c.and_then(|c| r.get(c)).cloned().unwrap_or(Data::Empty);
    let rows = rows
        .map(|r| {
            (
                cols.iter().map(|&c| pick(r, c)).collect(),
                extra_cols.iter().map(|&c| pick(r, Some(c))).collect(),
            )
        })
        .collect();
    Ok(SheetRows {
        extra_headers,
        rows,
    })
}

/// The non-blank extra cells of a row, as text keyed by header.
fn extra_map(headers: &[String], cells_of_row: &[Data]) -> BTreeMap<String, String> {
    headers
        .iter()
        .zip(cells_of_row)
        .filter(|(_, c)| !cells::is_blank(c))
        .map(|(h, c)| (h.clone(), cells::text(c)))
        .collect()
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

/// A time of day from a settings cell: text `H:MM` / `HH:MM`, or an Excel time (what Excel
/// stores when the user types 8:30 into the cell).
fn time_of(d: &Data) -> Option<NaiveTime> {
    match d {
        Data::String(s) => NaiveTime::parse_from_str(s.trim(), "%H:%M").ok(),
        Data::DateTime(_) => cells::datetime(d).ok().flatten().map(|dt| dt.time()),
        Data::Float(f) if (0.0..1.0).contains(f) => {
            let secs = (f * 86_400.0).round() as u32;
            NaiveTime::from_num_seconds_from_midnight_opt(secs % 86_400, 0)
        }
        _ => None,
    }
}

/// Reads the common workbook. Not an xlsx -> `Corrupt`; no such file -> `Io`.
pub fn read_common_book(path: &Path) -> AppResult<CommonBook> {
    let mut wb: Xlsx<_> = open_workbook(path).map_err(xlsx_err)?;

    let mut projects: Vec<Project> = Vec::new();
    let mut project_extra = BTreeMap::new();
    let mut seen = HashSet::new();
    let sheet = sheet_rows(&mut wb, SHEET_PROJECTS, PROJECT_HEADERS)?;
    for (i, (r, extra)) in sheet.rows.iter().enumerate() {
        let name = cells::text(&r[0]).trim().to_string();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        let extra = extra_map(&sheet.extra_headers, extra);
        if !extra.is_empty() {
            project_extra.insert(name.clone(), extra);
        }
        projects.push(Project {
            inbox: name == INBOX,
            name,
            color: color_or_default(&r[1]),
            order: order_or(&r[2], i),
            favorite: truthy(&r[3]),
        });
    }

    let project_columns = sheet.extra_headers;

    let mut labels: Vec<Label> = Vec::new();
    let mut label_extra = BTreeMap::new();
    let mut seen = HashSet::new();
    let sheet = sheet_rows(&mut wb, SHEET_LABELS, LABEL_HEADERS)?;
    for (i, (r, extra)) in sheet.rows.iter().enumerate() {
        let name = cells::text(&r[0]).trim().to_string();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        let extra = extra_map(&sheet.extra_headers, extra);
        if !extra.is_empty() {
            label_extra.insert(name.clone(), extra);
        }
        labels.push(Label {
            name,
            color: color_or_default(&r[1]),
            order: order_or(&r[2], i),
        });
    }

    let label_columns = sheet.extra_headers;

    let mut holidays: Vec<NaiveDate> = Vec::new();
    let mut holiday_names = BTreeMap::new();
    let mut unparsed_holidays = Vec::new();
    for (r, _) in sheet_rows(&mut wb, SHEET_HOLIDAYS, HOLIDAY_HEADERS)?.rows {
        let Some(date) = date_of(&r[0]) else {
            if !r.iter().all(cells::is_blank) {
                unparsed_holidays.push(r.iter().map(cells::to_raw).collect());
            }
            continue;
        };
        holidays.push(date);
        let label = cells::text(&r[1]).trim().to_string();
        if !label.is_empty() {
            holiday_names.insert(date, label);
        }
    }
    holidays.sort();
    holidays.dedup();

    let mut settings = Settings::default_for_user();
    let mut extra_settings: Vec<(String, String)> = Vec::new();
    for (r, _) in sheet_rows(&mut wb, SHEET_SETTINGS, SETTINGS_HEADERS)?.rows {
        let key = cells::text(&r[0]).trim().to_string();
        let value = cells::text(&r[1]).trim().to_string();
        match key.as_str() {
            "" => {}
            KEY_DISPLAY_NAME if !value.is_empty() => settings.display_name = value,
            KEY_WEEK_START if matches!(value.as_str(), "mon" | "sun") => {
                settings.week_start = value;
            }
            KEY_TIMEZONE if !value.is_empty() => settings.timezone = value,
            KEY_DEFAULT_REMINDER if value == NONE_WORD => settings.default_reminder = None,
            KEY_DEFAULT_REMINDER
                if reminders::parse_code(&value).is_some() && !reminders::is_absolute(&value) =>
            {
                settings.default_reminder = Some(value);
            }
            KEY_NOTIFY_TIME => {
                if let Some(t) = time_of(&r[1]) {
                    settings.notify_time = t;
                }
            }
            KEY_KEEP_IN_TRAY if matches!(value.as_str(), YES | NO) => {
                settings.keep_in_tray = value == YES;
            }
            KEY_NOTIFICATIONS if matches!(value.as_str(), YES | NO) => {
                settings.notifications = value == YES;
            }
            KEY_DISPLAY_NAME | KEY_WEEK_START | KEY_TIMEZONE | KEY_DEFAULT_REMINDER
            | KEY_KEEP_IN_TRAY | KEY_NOTIFICATIONS => {}
            _ if extra_settings.iter().any(|(k, _)| *k == key) => {}
            _ => extra_settings.push((key, value)),
        }
    }

    Ok(CommonBook {
        projects,
        labels,
        holidays,
        holiday_names,
        unparsed_holidays,
        settings,
        extra_settings,
        project_columns,
        project_extra,
        label_columns,
        label_extra,
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

fn with_extra<'a>(known: &[&'a str], extra: &'a [String]) -> Vec<&'a str> {
    known
        .iter()
        .copied()
        .chain(extra.iter().map(String::as_str))
        .collect()
}

fn write_extra_cells(
    ws: &mut Worksheet,
    row: u32,
    first_col: usize,
    columns: &[String],
    values: Option<&BTreeMap<String, String>>,
) -> Result<(), XlsxError> {
    let Some(values) = values else {
        return Ok(());
    };
    for (j, name) in columns.iter().enumerate() {
        if let Some(v) = values.get(name) {
            ws.write_string(row, (first_col + j) as u16, v)?;
        }
    }
    Ok(())
}

fn build_workbook(book: &CommonBook) -> Result<Workbook, XlsxError> {
    let mut wb = Workbook::new();

    let ws = wb.add_worksheet();
    write_header(
        ws,
        SHEET_PROJECTS,
        &with_extra(PROJECT_HEADERS, &book.project_columns),
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
        write_extra_cells(
            ws,
            r,
            PROJECT_HEADERS.len(),
            &book.project_columns,
            book.project_extra.get(&p.name),
        )?;
    }

    let ws = wb.add_worksheet();
    write_header(
        ws,
        SHEET_LABELS,
        &with_extra(LABEL_HEADERS, &book.label_columns),
    )?;
    ws.set_column_width(0, 24)?;
    ws.set_column_width(1, 28)?;
    for (i, l) in book.labels.iter().enumerate() {
        let r = i as u32 + 1;
        ws.write_string(r, 0, &l.name)?;
        ws.write_string(r, 1, &l.color)?;
        ws.write_number(r, 2, l.order)?;
        write_extra_cells(
            ws,
            r,
            LABEL_HEADERS.len(),
            &book.label_columns,
            book.label_extra.get(&l.name),
        )?;
    }

    write_header(
        wb.add_worksheet(),
        SHEET_FILTERS,
        &["名前", "クエリ", "並び順"],
    )?;

    let ws = wb.add_worksheet();
    write_header(ws, SHEET_HOLIDAYS, HOLIDAY_HEADERS)?;
    let date_fmt = style::date_format();
    let datetime_fmt = style::datetime_format();
    let mut days = book.holidays.clone();
    days.sort();
    days.dedup();
    let mut r = 1;
    for d in &days {
        ws.write_datetime_with_format(r, 0, *d, &date_fmt)?;
        if let Some(n) = book.holiday_names.get(d) {
            ws.write_string(r, 1, n)?;
        }
        r += 1;
    }
    for row in &book.unparsed_holidays {
        for (c, cell) in row.iter().enumerate() {
            write_raw(ws, r, c as u16, cell, &date_fmt, &datetime_fmt)?;
        }
        r += 1;
    }

    let ws = wb.add_worksheet();
    write_header(ws, SHEET_SETTINGS, SETTINGS_HEADERS)?;
    let s = &book.settings;
    let notify_time = s.notify_time.format("%H:%M").to_string();
    let yes_no = |b: bool| if b { YES } else { NO };
    let known = [
        (KEY_DISPLAY_NAME, s.display_name.as_str()),
        (KEY_WEEK_START, s.week_start.as_str()),
        (KEY_TIMEZONE, s.timezone.as_str()),
        (
            KEY_DEFAULT_REMINDER,
            s.default_reminder.as_deref().unwrap_or(NONE_WORD),
        ),
        (KEY_NOTIFY_TIME, notify_time.as_str()),
        (KEY_KEEP_IN_TRAY, yes_no(s.keep_in_tray)),
        (KEY_NOTIFICATIONS, yes_no(s.notifications)),
    ];
    let extra = book
        .extra_settings
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()));
    for (i, (k, v)) in known.into_iter().chain(extra).enumerate() {
        ws.write_string(i as u32 + 1, 0, k)?;
        if !v.is_empty() {
            ws.write_string(i as u32 + 1, 1, v)?;
        }
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
                ..Settings::default_for_user()
            },
            ..CommonBook::new_default()
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

    fn header(ws: &mut rust_xlsxwriter::Worksheet, name: &str, headers: &[&str]) {
        ws.set_name(name).unwrap();
        for (c, h) in headers.iter().enumerate() {
            ws.write_string(0, c as u16, *h).unwrap();
        }
    }

    fn sheet_text(p: &Path, sheet: &str) -> Vec<Vec<String>> {
        let mut wb: Xlsx<_> = open_workbook(p).unwrap();
        let range = wb.worksheet_range(sheet).unwrap();
        range
            .rows()
            .map(|r| r.iter().map(cells::text).collect())
            .collect()
    }

    #[test]
    fn common_book_keeps_unparsed_holiday_rows() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        header(ws, "祝日", &["日付", "名称"]);
        ws.write_string(1, 0, "2026-01-01").unwrap();
        ws.write_string(1, 1, "元日").unwrap();
        ws.write_string(2, 0, "未定").unwrap();
        ws.write_string(2, 1, "創立記念日").unwrap();
        ws.write_string(3, 1, "日付なし").unwrap();
        wb.save(&p).unwrap();

        let b = read_common_book(&p).unwrap();
        assert_eq!(b.holidays, vec![d(2026, 1, 1)]);
        assert_eq!(b.unparsed_holidays.len(), 2, "{:?}", b.unparsed_holidays);

        let out = dir.path().join("out.xlsx");
        write_common_book(&out, &b).unwrap();
        assert_eq!(read_common_book(&out).unwrap(), b);
        let rows = sheet_text(&out, "祝日");
        assert!(rows.contains(&vec!["未定".to_string(), "創立記念日".to_string()]));
        assert!(
            rows.iter()
                .any(|r| r.get(1).map(String::as_str) == Some("日付なし"))
        );
    }

    #[test]
    fn common_book_keeps_unknown_settings_and_columns() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        header(ws, "プロジェクト", &["名前", "メモ", "色", "担当者"]);
        ws.write_string(1, 0, INBOX).unwrap();
        ws.write_string(1, 1, "受信用").unwrap();
        ws.write_string(2, 0, "仕事").unwrap();
        ws.write_string(2, 2, "var(--x)").unwrap();
        ws.write_string(2, 3, "たろう").unwrap();
        let ws = wb.add_worksheet();
        header(ws, "ラベル", &["名前", "色", "並び順", "説明"]);
        ws.write_string(1, 0, "急ぎ").unwrap();
        ws.write_string(1, 3, "今日中").unwrap();
        let ws = wb.add_worksheet();
        header(ws, "設定", &["キー", "値"]);
        ws.write_string(1, 0, "表示名").unwrap();
        ws.write_string(1, 1, "はなこ").unwrap();
        ws.write_string(2, 0, "通知音").unwrap();
        ws.write_string(2, 1, "オン").unwrap();
        ws.write_string(3, 0, "週の開始").unwrap();
        ws.write_string(3, 1, "sun").unwrap();
        wb.save(&p).unwrap();

        let b = read_common_book(&p).unwrap();
        assert_eq!(b.settings.display_name, "はなこ");
        assert_eq!(b.settings.week_start, "sun");
        assert_eq!(
            b.extra_settings,
            vec![("通知音".to_string(), "オン".to_string())]
        );
        assert_eq!(b.project_columns, vec!["メモ", "担当者"]);
        assert_eq!(b.project_extra[INBOX]["メモ"], "受信用");
        assert_eq!(b.project_extra["仕事"]["担当者"], "たろう");
        assert_eq!(b.label_columns, vec!["説明"]);
        assert_eq!(b.label_extra["急ぎ"]["説明"], "今日中");

        let out = dir.path().join("out.xlsx");
        write_common_book(&out, &b).unwrap();
        assert_eq!(read_common_book(&out).unwrap(), b);
        let rows = sheet_text(&out, "プロジェクト");
        assert_eq!(
            rows[0],
            vec![
                "名前",
                "色",
                "並び順",
                "お気に入り",
                "受信トレイ",
                "メモ",
                "担当者"
            ]
        );
        let rows = sheet_text(&out, "設定");
        assert!(rows.contains(&vec!["通知音".to_string(), "オン".to_string()]));
    }

    #[test]
    fn phase3_settings_round_trip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(COMMON_FILE);
        let mut book = CommonBook::new_default();
        assert_eq!(book.settings.default_reminder.as_deref(), Some("-0m"));
        assert_eq!(
            book.settings.notify_time,
            NaiveTime::from_hms_opt(9, 0, 0).unwrap()
        );
        assert!(book.settings.keep_in_tray);
        assert!(book.settings.notifications);
        book.settings.default_reminder = None;
        book.settings.notify_time = NaiveTime::from_hms_opt(8, 30, 0).unwrap();
        book.settings.keep_in_tray = false;
        book.settings.notifications = false;
        write_common_book(&path, &book).unwrap();
        let back = read_common_book(&path).unwrap();
        assert_eq!(back.settings, book.settings);
        assert!(back.extra_settings.is_empty());
    }

    #[test]
    fn invalid_phase3_settings_fall_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        header(ws, "設定", &["キー", "値"]);
        for (i, (k, v)) in [
            ("既定リマインダー", "-5m"),
            ("時刻なしの通知時刻", "25:00"),
            ("閉じたときトレイに残す", "たぶん"),
            ("通知", "maybe"),
        ]
        .into_iter()
        .enumerate()
        {
            ws.write_string(i as u32 + 1, 0, k).unwrap();
            ws.write_string(i as u32 + 1, 1, v).unwrap();
        }
        wb.save(&p).unwrap();
        let b = read_common_book(&p).unwrap();
        assert_eq!(b.settings.default_reminder.as_deref(), Some("-0m"));
        assert_eq!(
            b.settings.notify_time,
            NaiveTime::from_hms_opt(9, 0, 0).unwrap()
        );
        assert!(b.settings.keep_in_tray && b.settings.notifications);
        assert!(b.extra_settings.is_empty());
    }

    #[test]
    fn notify_time_reads_an_excel_time_cell_and_short_text() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        header(ws, "設定", &["キー", "値"]);
        ws.write_string(1, 0, "時刻なしの通知時刻").unwrap();
        let fmt = rust_xlsxwriter::Format::new().set_num_format("hh:mm");
        let t = rust_xlsxwriter::ExcelDateTime::from_hms(8, 30, 0.0).unwrap();
        ws.write_datetime_with_format(1, 1, &t, &fmt).unwrap();
        wb.save(&p).unwrap();
        let b = read_common_book(&p).unwrap();
        assert_eq!(
            b.settings.notify_time,
            NaiveTime::from_hms_opt(8, 30, 0).unwrap()
        );
        assert!(b.extra_settings.is_empty());

        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        header(ws, "設定", &["キー", "値"]);
        ws.write_string(1, 0, "時刻なしの通知時刻").unwrap();
        ws.write_string(1, 1, "8:30").unwrap();
        wb.save(&p).unwrap();
        let b = read_common_book(&p).unwrap();
        assert_eq!(
            b.settings.notify_time,
            NaiveTime::from_hms_opt(8, 30, 0).unwrap()
        );
    }

    #[test]
    fn absolute_default_reminder_in_the_sheet_falls_back() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(COMMON_FILE);
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        header(ws, "設定", &["キー", "値"]);
        ws.write_string(1, 0, "既定リマインダー").unwrap();
        ws.write_string(1, 1, "2026-10-13T07:00").unwrap();
        wb.save(&p).unwrap();
        let b = read_common_book(&p).unwrap();
        assert_eq!(b.settings.default_reminder.as_deref(), Some("-0m"));
    }
}
