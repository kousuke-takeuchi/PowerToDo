//! Project workbook (`<name>.xlsx`): read with calamine, write with rust_xlsxwriter.
//!
//! Known round-trip limits (callers must account for them):
//! - A 終了 date-time of exactly 00:00 reads back as a date-only due: calamine does not expose
//!   the cell's number format, so a midnight date-time and a date are indistinguishable. The
//!   project store (Task 5) therefore treats `due_time == 00:00` as `None`.
//! - Invalid rows are written back after the valid tasks, so their Excel row numbers (and the
//!   `invalid_rows[].row` / `invalid_cells` keys) change after a save. Callers re-read the
//!   book after writing instead of reusing those row numbers.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use calamine::{Data, Range, Reader, Xlsx, open_workbook};
use chrono::{Datelike, NaiveDate, NaiveDateTime, NaiveTime};
use rust_xlsxwriter::{Format, Workbook, Worksheet, XlsxError};

use super::cells::{self, RawCell};
use super::style;
use crate::domain::dates::business_days;
use crate::domain::{InvalidRow, Priority, Task};
use crate::error::{AppError, AppResult};

pub const TASK_SHEET: &str = "タスク一覧";
pub const SETTINGS_SHEET: &str = "設定";

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProjectBook {
    pub project: String,
    pub sections: Vec<String>,
    pub assignees: Vec<String>,
    pub tasks: Vec<Task>,
    pub invalid_rows: Vec<InvalidRow>,
    pub unknown_columns: Vec<String>,
    pub invalid_cells: BTreeMap<u32, Vec<RawCell>>,
}

/// Header texts of the known columns A..R, in column order.
pub const HEADERS: [&str; 18] = [
    "No.",
    "プロジェクト",
    "カテゴリ",
    "タスク",
    "担当",
    "優先度",
    "進捗",
    "開始",
    "終了",
    "日数",
    "備考",
    "親No.",
    "ラベル",
    "繰り返し",
    "リマインダー",
    "並び順",
    "作成日時",
    "完了日時",
];

const C_NO: usize = 0;
const C_PROJECT: usize = 1;
const C_CATEGORY: usize = 2;
const C_TITLE: usize = 3;
const C_ASSIGNEE: usize = 4;
const C_PRIORITY: usize = 5;
const C_PROGRESS: usize = 6;
const C_START: usize = 7;
const C_DUE: usize = 8;
const C_DAYS: usize = 9;
const C_NOTE: usize = 10;
const C_PARENT: usize = 11;
const C_LABELS: usize = 12;
const C_RRULE: usize = 13;
const C_REMINDERS: usize = 14;
const C_ORDER: usize = 15;
const C_CREATED: usize = 16;
const C_COMPLETED: usize = 17;

/// `created_at` for rows from a workbook without a 作成日時 column or cell. The store must not
/// read the clock, so the caller (project store) replaces this value with "now".
pub fn created_at_sentinel() -> NaiveDateTime {
    NaiveDate::from_ymd_opt(1970, 1, 1)
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .unwrap_or_default()
}

pub(super) fn xlsx_err(e: calamine::XlsxError) -> AppError {
    match e {
        calamine::XlsxError::Io(io) => io.into(),
        other => AppError::Corrupt {
            message: other.to_string(),
        },
    }
}

static EMPTY: Data = Data::Empty;

/// The task sheet with the header-name -> column mapping applied.
struct Sheet<'a> {
    range: &'a Range<Data>,
    cols: [Option<u32>; 18],
}

impl Sheet<'_> {
    /// `r` is the absolute 0-based row.
    fn cell(&self, r: u32, k: usize) -> &Data {
        self.cols[k]
            .and_then(|c| self.range.get_value((r, c)))
            .unwrap_or(&EMPTY)
    }
}

/// Reads a project workbook. The header row (row 1 of 「タスク一覧」) decides which column is
/// which, so reordered columns still load. Rows with broken cell types become
/// `invalid_rows` (and are kept verbatim in `invalid_cells`) instead of failing the load.
pub fn read_project_book(path: &Path) -> AppResult<ProjectBook> {
    let mut wb: Xlsx<_> = open_workbook(path).map_err(xlsx_err)?;
    let range = wb.worksheet_range(TASK_SHEET).map_err(|e| match e {
        calamine::XlsxError::WorksheetNotFound(_) => AppError::Corrupt {
            message: format!("シート「{TASK_SHEET}」がありません"),
        },
        other => xlsx_err(other),
    })?;
    let (end_row, end_col) = match (range.start(), range.end()) {
        (Some((0, _)), Some(end)) => end,
        _ => {
            return Err(AppError::Corrupt {
                message: format!("シート「{TASK_SHEET}」の 1 行目に見出しがありません"),
            });
        }
    };

    let mut cols: [Option<u32>; 18] = [None; 18];
    let mut unknown: Vec<(String, u32)> = Vec::new();
    for c in 0..=end_col {
        let Some(cell) = range.get_value((0, c)) else {
            continue;
        };
        let name = cells::text(cell).trim().to_string();
        if name.is_empty() {
            continue;
        }
        match HEADERS.iter().position(|h| *h == name) {
            Some(k) => {
                if cols[k].is_none() {
                    cols[k] = Some(c);
                }
            }
            None => {
                if !unknown.iter().any(|(n, _)| *n == name) {
                    unknown.push((name, c));
                }
            }
        }
    }
    if cols[C_NO].is_none() || cols[C_TITLE].is_none() {
        return Err(AppError::Corrupt {
            message: "見出し行に「No.」と「タスク」がありません".into(),
        });
    }

    let project = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let sheet = Sheet {
        range: &range,
        cols,
    };
    let mut book = ProjectBook {
        project: project.clone(),
        unknown_columns: unknown.iter().map(|(n, _)| n.clone()).collect(),
        ..Default::default()
    };
    let mut seen = HashSet::new();

    for r in 1..=end_row {
        if cells::is_blank(sheet.cell(r, C_NO)) && cells::is_blank(sheet.cell(r, C_TITLE)) {
            continue;
        }
        let excel_row = r + 1;
        match parse_row(&sheet, r, &project, &unknown, &mut seen) {
            Ok(task) => book.tasks.push(task),
            Err(bad) => {
                let mut raw: Vec<RawCell> = (0..HEADERS.len())
                    .map(|k| cells::to_raw(sheet.cell(r, k)))
                    .collect();
                for (_, c) in &unknown {
                    raw.push(
                        range
                            .get_value((r, *c))
                            .map_or(RawCell::Empty, cells::to_raw),
                    );
                }
                book.invalid_cells.insert(excel_row, raw);
                book.invalid_rows.push(InvalidRow {
                    row: excel_row,
                    ..bad
                });
            }
        }
    }

    if let Ok(settings) = wb.worksheet_range(SETTINGS_SHEET) {
        book.sections = list_under(&settings, "カテゴリ");
        book.assignees = list_under(&settings, "担当");
    }
    Ok(book)
}

/// Values below the first cell whose text is `header`, up to the first blank cell.
fn list_under(range: &Range<Data>, header: &str) -> Vec<String> {
    let (r0, c0) = range.start().unwrap_or((0, 0));
    let Some((hr, hc)) = range
        .used_cells()
        .find(|(_, _, d)| cells::text(d).trim() == header)
        .map(|(r, c, _)| (r0 + r as u32, c0 + c as u32))
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut r = hr + 1;
    while let Some(d) = range.get_value((r, hc)) {
        if cells::is_blank(d) {
            break;
        }
        out.push(cells::text(d).trim().to_string());
        r += 1;
    }
    out
}

fn parse_row(
    sheet: &Sheet,
    r: u32,
    project: &str,
    unknown: &[(String, u32)],
    seen: &mut HashSet<u32>,
) -> Result<Task, InvalidRow> {
    let bad = |no: Option<u32>, k: usize, message: &str, value: String| InvalidRow {
        row: 0,
        no,
        column: HEADERS[k].to_string(),
        value,
        message: message.to_string(),
    };
    let raw_text = |k: usize| cells::text(sheet.cell(r, k));
    let cell = |k: usize| sheet.cell(r, k);

    // No.
    let no = match cells::integer(cell(C_NO)) {
        Ok(Some(n)) if (1..=i64::from(u32::MAX)).contains(&n) => n as u32,
        Ok(None) => return Err(bad(None, C_NO, "No. が空です", String::new())),
        _ => {
            return Err(bad(
                None,
                C_NO,
                "No. は 1 以上の整数にしてください",
                raw_text(C_NO),
            ));
        }
    };
    let no_r = Some(no);
    if !seen.insert(no) {
        return Err(bad(no_r, C_NO, "No. が重複しています", raw_text(C_NO)));
    }

    let priority = match cells::text(cell(C_PRIORITY)).trim() {
        "" => 4,
        "高" => 1,
        "中" => 2,
        "低" => 3,
        other => {
            return Err(bad(
                no_r,
                C_PRIORITY,
                "優先度は 高 / 中 / 低 のいずれかです",
                other.to_string(),
            ));
        }
    };

    let progress = match cells::integer(cell(C_PROGRESS)) {
        Ok(None) => 0,
        Ok(Some(n)) if (0..=100).contains(&n) => n as u8,
        _ => {
            return Err(bad(
                no_r,
                C_PROGRESS,
                "進捗は 0〜100 の整数にしてください",
                raw_text(C_PROGRESS),
            ));
        }
    };

    let date_cell = |k: usize, msg: &str| -> Result<Option<NaiveDateTime>, InvalidRow> {
        cells::datetime(cell(k)).map_err(|_| bad(no_r, k, msg, raw_text(k)))
    };
    let start = date_cell(C_START, "日付ではありません")?.map(|d| d.date());
    let due_dt = date_cell(C_DUE, "日付ではありません")?;
    let created = date_cell(C_CREATED, "日時ではありません")?;
    let completed = date_cell(C_COMPLETED, "日時ではありません")?;

    let int_cell = |k: usize, msg: &str| -> Result<Option<u32>, InvalidRow> {
        match cells::integer(cell(k)) {
            Ok(None) => Ok(None),
            Ok(Some(n)) if (0..=i64::from(u32::MAX)).contains(&n) => Ok(Some(n as u32)),
            _ => Err(bad(no_r, k, msg, raw_text(k))),
        }
    };
    let parent_no = match int_cell(C_PARENT, "親No. は 1 以上の整数にしてください")? {
        Some(0) => {
            return Err(bad(
                no_r,
                C_PARENT,
                "親No. は 1 以上の整数にしてください",
                raw_text(C_PARENT),
            ));
        }
        other => other,
    };
    let order = int_cell(C_ORDER, "並び順は整数にしてください")?;
    let days = cells::integer(cell(C_DAYS))
        .ok()
        .flatten()
        .and_then(|n| u32::try_from(n).ok());

    let string = |k: usize| -> Option<String> {
        let t = cells::text(cell(k));
        (!t.trim().is_empty()).then_some(t)
    };
    let list = |k: usize| -> Vec<String> {
        cells::text(cell(k))
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };

    let (due, due_time) = match due_dt {
        None => (None, None),
        Some(d) => {
            let t = d.time();
            (Some(d.date()), (t != NaiveTime::MIN).then_some(t))
        }
    };

    let mut extra = BTreeMap::new();
    for (name, c) in unknown {
        if let Some(d) = sheet.range.get_value((r, *c)) {
            let t = cells::text(d);
            if !t.trim().is_empty() {
                extra.insert(name.clone(), t);
            }
        }
    }

    Ok(Task {
        no,
        project: string(C_PROJECT)
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| project.to_string()),
        category: string(C_CATEGORY).map(|s| s.trim().to_string()),
        title: cells::text(cell(C_TITLE)).trim().to_string(),
        assignee: cells::text(cell(C_ASSIGNEE)).trim().to_string(),
        priority: Priority(priority),
        progress,
        start,
        due,
        due_time,
        days,
        note: string(C_NOTE),
        parent_no,
        labels: list(C_LABELS),
        rrule: string(C_RRULE).map(|s| s.trim().to_string()),
        reminders: list(C_REMINDERS),
        order: order.unwrap_or(r),
        created_at: created.unwrap_or_else(created_at_sentinel),
        completed_at: completed,
        extra,
    })
}

pub(super) fn xlsx_write_err(e: XlsxError) -> AppError {
    AppError::Io {
        message: e.to_string(),
    }
}

/// Writes the whole workbook to a temp file in the target directory, then renames it over
/// `path`. A failure at any point leaves the existing file untouched.
///
/// `today` is not needed: 条件付き書式 use Excel's `TODAY()`. It is kept for API stability.
pub fn write_project_book(
    path: &Path,
    book: &ProjectBook,
    _today: NaiveDate,
    holidays: &[NaiveDate],
) -> AppResult<()> {
    let mut wb = build_workbook(book, holidays).map_err(xlsx_write_err)?;
    persist_workbook(&mut wb, path)
}

/// Saves `wb` to a temp file next to `path`, fsyncs it and renames it over `path`.
pub(super) fn persist_workbook(wb: &mut Workbook, path: &Path) -> AppResult<()> {
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let mut tmp = tempfile::Builder::new()
        .prefix(".powertodo-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    wb.save_to_writer(tmp.as_file_mut())
        .map_err(xlsx_write_err)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| AppError::from(e.error))?;
    Ok(())
}

fn priority_text(p: Priority) -> Option<&'static str> {
    match p.0 {
        1 => Some("高"),
        2 => Some("中"),
        3 => Some("低"),
        _ => None,
    }
}

/// Extra-column value back to a cell, undoing `cells::text`: a text that is exactly how a
/// finite number prints becomes a number, `%Y-%m-%d` / `%Y-%m-%d %H:%M` become date / date-time
/// cells (only for years 1900..=9999, which Excel can show; earlier text stays text), `TRUE` /
/// `FALSE` become booleans, anything else stays text.
fn write_extra(ws: &mut Worksheet, row: u32, col: u16, value: &str) -> Result<(), XlsxError> {
    if let Ok(f) = value.parse::<f64>()
        && f.is_finite()
        && cells::number_text(f) == value
    {
        ws.write_number(row, col, f)?;
    } else if let Ok(d) = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        && d.format("%Y-%m-%d").to_string() == value
        && (1900..=9999).contains(&d.year())
    {
        ws.write_datetime_with_format(row, col, d, &style::date_format())?;
    } else if let Ok(dt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M")
        && dt.format("%Y-%m-%d %H:%M").to_string() == value
        && (1900..=9999).contains(&dt.year())
    {
        ws.write_datetime_with_format(row, col, dt, &style::datetime_format())?;
    } else if value == "TRUE" || value == "FALSE" {
        ws.write_boolean(row, col, value == "TRUE")?;
    } else {
        ws.write_string(row, col, value)?;
    }
    Ok(())
}

fn build_workbook(book: &ProjectBook, holidays: &[NaiveDate]) -> Result<Workbook, XlsxError> {
    let mut wb = Workbook::new();
    let header = style::header_format();
    let date_fmt = style::date_format();
    let datetime_fmt = style::datetime_format();
    let wrap = Format::new().set_text_wrap();

    // Unknown columns: the ones read from the file, then any key a task carries that is not
    // listed yet (stable order).
    let mut unknown = book.unknown_columns.clone();
    for t in &book.tasks {
        for k in t.extra.keys() {
            if !unknown.contains(k) {
                unknown.push(k.clone());
            }
        }
    }

    let ws = wb.add_worksheet();
    ws.set_name(TASK_SHEET)?;
    for (c, h) in HEADERS.iter().enumerate() {
        ws.write_string_with_format(0, c as u16, *h, &header)?;
    }
    for (j, name) in unknown.iter().enumerate() {
        ws.write_string_with_format(0, (HEADERS.len() + j) as u16, name, &header)?;
    }

    let mut row: u32 = 1;
    for t in &book.tasks {
        ws.write_number(row, C_NO as u16, t.no)?;
        ws.write_string(row, C_PROJECT as u16, &t.project)?;
        if let Some(c) = t.category.as_deref().filter(|s| !s.is_empty()) {
            ws.write_string(row, C_CATEGORY as u16, c)?;
        }
        ws.write_string(row, C_TITLE as u16, &t.title)?;
        if !t.assignee.is_empty() {
            ws.write_string(row, C_ASSIGNEE as u16, &t.assignee)?;
        }
        if let Some(p) = priority_text(t.priority) {
            ws.write_string(row, C_PRIORITY as u16, p)?;
        }
        ws.write_number(row, C_PROGRESS as u16, t.progress)?;
        if let Some(d) = t.start {
            ws.write_datetime_with_format(row, C_START as u16, d, &date_fmt)?;
        }
        match (t.due, t.due_time) {
            (Some(d), Some(time)) => {
                ws.write_datetime_with_format(row, C_DUE as u16, d.and_time(time), &datetime_fmt)?;
            }
            (Some(d), None) => {
                ws.write_datetime_with_format(row, C_DUE as u16, d, &date_fmt)?;
            }
            _ => {}
        }
        if let (Some(s), Some(d)) = (t.start, t.due) {
            ws.write_number(row, C_DAYS as u16, business_days(s, d, holidays))?;
        }
        if let Some(n) = t.note.as_deref().filter(|s| !s.is_empty()) {
            ws.write_string_with_format(row, C_NOTE as u16, n, &wrap)?;
        }
        if let Some(p) = t.parent_no {
            ws.write_number(row, C_PARENT as u16, p)?;
        }
        if !t.labels.is_empty() {
            ws.write_string(row, C_LABELS as u16, t.labels.join(","))?;
        }
        if let Some(r) = t.rrule.as_deref().filter(|s| !s.is_empty()) {
            ws.write_string(row, C_RRULE as u16, r)?;
        }
        if !t.reminders.is_empty() {
            ws.write_string(row, C_REMINDERS as u16, t.reminders.join(","))?;
        }
        ws.write_number(row, C_ORDER as u16, t.order)?;
        ws.write_datetime_with_format(row, C_CREATED as u16, t.created_at, &datetime_fmt)?;
        if let Some(c) = t.completed_at {
            ws.write_datetime_with_format(row, C_COMPLETED as u16, c, &datetime_fmt)?;
        }
        for (j, name) in unknown.iter().enumerate() {
            if let Some(v) = t.extra.get(name).filter(|s| !s.is_empty()) {
                write_extra(ws, row, (HEADERS.len() + j) as u16, v)?;
            }
        }
        row += 1;
    }

    // Rows that could not be read as tasks are written back as they were (appended after the
    // tasks, so their row numbers can shift).
    for cells_of_row in book.invalid_cells.values() {
        for (c, cell) in cells_of_row.iter().enumerate() {
            let col = c as u16;
            match cell {
                RawCell::Empty => {}
                RawCell::Text(s) => {
                    ws.write_string(row, col, s)?;
                }
                RawCell::Number(n) => {
                    ws.write_number(row, col, *n)?;
                }
                RawCell::DateTime(d) => {
                    let f = if d.time() == NaiveTime::MIN {
                        &date_fmt
                    } else {
                        &datetime_fmt
                    };
                    ws.write_datetime_with_format(row, col, *d, f)?;
                }
            }
        }
        row += 1;
    }

    style::apply_task_sheet_layout(ws, row - 1)?;
    if !unknown.is_empty() {
        let last_col = (HEADERS.len() + unknown.len() - 1) as u16;
        ws.autofilter(0, 0, (row - 1).max(1), last_col)?;
    }

    write_settings(wb.add_worksheet(), book)?;
    Ok(wb)
}

/// 「設定」: A1:D2 hold the table position (見出し行 / 開始行 / 開始列 / 終了列, labels in
/// row 1, values in row 2). F4 カテゴリ, G4 担当, H4 優先度 are headers; their values start
/// in row 5 (30 rows reserved).
fn write_settings(ws: &mut Worksheet, book: &ProjectBook) -> Result<(), XlsxError> {
    let header = style::header_format();
    ws.set_name(SETTINGS_SHEET)?;
    for (c, label) in ["見出し行", "開始行", "開始列", "終了列"]
        .iter()
        .enumerate()
    {
        ws.write_string_with_format(0, c as u16, *label, &header)?;
    }
    ws.write_number(1, 0, 1)?;
    ws.write_number(1, 1, 2)?;
    ws.write_string(1, 2, "A")?;
    ws.write_string(1, 3, "R")?;

    ws.write_string_with_format(3, 5, "カテゴリ", &header)?;
    ws.write_string_with_format(3, 6, "担当", &header)?;
    ws.write_string_with_format(3, 7, "優先度", &header)?;
    for (i, s) in book.sections.iter().enumerate() {
        ws.write_string(4 + i as u32, 5, s)?;
    }
    for (i, a) in book.assignees.iter().enumerate() {
        ws.write_string(4 + i as u32, 6, a)?;
    }
    for (i, p) in ["高", "中", "低"].iter().enumerate() {
        ws.write_string(4 + i as u32, 7, *p)?;
    }
    for c in 0..4 {
        ws.set_column_width(c, 10)?;
    }
    for c in 5..8 {
        ws.set_column_width(c, 14)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Priority;
    use crate::domain::dates::business_days;
    use chrono::NaiveTime;
    use rust_xlsxwriter::{Workbook, Worksheet};
    use std::path::PathBuf;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").unwrap()
    }

    fn base_task(no: u32, title: &str) -> Task {
        Task {
            no,
            project: "仕事".into(),
            category: None,
            title: title.into(),
            assignee: "たろう".into(),
            priority: Priority(4),
            progress: 0,
            start: None,
            due: None,
            due_time: None,
            days: None,
            note: None,
            parent_no: None,
            labels: vec![],
            rrule: None,
            reminders: vec![],
            order: no,
            created_at: dt("2026-10-10T09:00"),
            completed_at: None,
            extra: BTreeMap::new(),
        }
    }

    fn three_tasks() -> Vec<Task> {
        let mut parent = base_task(1, "資料を作る");
        parent.category = Some("今週".into());
        parent.priority = Priority(1);
        parent.start = Some(d(2026, 10, 12));
        parent.due = Some(d(2026, 10, 14));
        parent.due_time = Some(NaiveTime::from_hms_opt(15, 30, 0).unwrap());
        parent.days = Some(business_days(d(2026, 10, 12), d(2026, 10, 14), &[]));
        parent.note = Some("1 行目\n2 行目".into());
        parent.labels = vec!["急ぎ".into(), "会議".into()];
        parent.rrule = Some("FREQ=WEEKLY;BYDAY=MO".into());
        parent.reminders = vec!["-30m".into(), "2026-10-14 09:00".into()];

        let mut child = base_task(2, "表を作る");
        child.parent_no = Some(1);
        child.category = Some("今週".into());
        child.priority = Priority(2);
        child.order = 2;

        let mut done = base_task(3, "メールを返す");
        done.priority = Priority(3);
        done.progress = 100;
        done.due = Some(d(2026, 10, 9));
        done.completed_at = Some(dt("2026-10-09T17:45"));
        vec![parent, child, done]
    }

    fn book(tasks: Vec<Task>) -> ProjectBook {
        ProjectBook {
            project: "仕事".into(),
            sections: vec!["今週".into(), "来週".into()],
            assignees: vec!["たろう".into(), "はなこ".into()],
            tasks,
            ..Default::default()
        }
    }

    const QIITA_HEADERS: [&str; 11] = [
        "No.",
        "プロジェクト",
        "カテゴリ",
        "タスク",
        "担当",
        "優先度",
        "進捗",
        "開始",
        "終了",
        "日数",
        "備考",
    ];

    fn write_headers(ws: &mut Worksheet, headers: &[&str]) {
        for (c, h) in headers.iter().enumerate() {
            ws.write_string(0, c as u16, *h).unwrap();
        }
    }

    fn date_fmt() -> rust_xlsxwriter::Format {
        rust_xlsxwriter::Format::new().set_num_format("yyyy-mm-dd")
    }

    /// Handmade Qiita-style book (11 columns, optional extra column) written without
    /// `write_project_book`. Row 3 has the text "来週" in 終了 when `bad_due` is set.
    fn handmade(path: &Path, extra_col: bool, bad_due: bool) {
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.set_name(TASK_SHEET).unwrap();
        let mut headers = QIITA_HEADERS.to_vec();
        if extra_col {
            headers.push("メモ2");
        }
        write_headers(ws, &headers);
        let f = date_fmt();
        let rows: [(f64, &str, &str, &str, &str); 3] = [
            (1.0, "仕事", "今週", "企画書", "高"),
            (2.0, "仕事", "今週", "見積り", "中"),
            (3.0, "仕事", "来週", "請求書", "低"),
        ];
        for (i, (no, proj, cat, title, prio)) in rows.iter().enumerate() {
            let r = (i + 1) as u32;
            ws.write_number(r, 0, *no).unwrap();
            ws.write_string(r, 1, *proj).unwrap();
            ws.write_string(r, 2, *cat).unwrap();
            ws.write_string(r, 3, *title).unwrap();
            ws.write_string(r, 4, "たろう").unwrap();
            ws.write_string(r, 5, *prio).unwrap();
            ws.write_number(r, 6, 50.0).unwrap();
            ws.write_datetime_with_format(r, 7, d(2026, 10, 12), &f)
                .unwrap();
            if bad_due && r == 2 {
                ws.write_string(r, 8, "来週").unwrap();
            } else {
                ws.write_datetime_with_format(r, 8, d(2026, 10, 14), &f)
                    .unwrap();
            }
            ws.write_number(r, 9, 3.0).unwrap();
            ws.write_string(r, 10, "メモ").unwrap();
            if extra_col {
                ws.write_string(r, 11, format!("x{r}")).unwrap();
            }
        }
        let st = wb.add_worksheet();
        st.set_name(SETTINGS_SHEET).unwrap();
        st.write_string(3, 5, "カテゴリ").unwrap();
        st.write_string(4, 5, "今週").unwrap();
        st.write_string(5, 5, "来週").unwrap();
        st.write_string(3, 6, "担当").unwrap();
        st.write_string(4, 6, "たろう").unwrap();
        wb.save(path).unwrap();
    }

    fn tmp() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("仕事.xlsx");
        (dir, p)
    }

    #[test]
    fn round_trip_preserves_tasks_and_unknown_columns() {
        let (_dir, p) = tmp();
        let b = book(three_tasks());
        write_project_book(&p, &b, d(2026, 10, 14), &[]).unwrap();
        let back = read_project_book(&p).unwrap();
        assert_eq!(back.tasks, b.tasks);
        assert_eq!(back.sections, b.sections);
        assert_eq!(back.assignees, b.assignees);
        assert_eq!(back.project, "仕事");
        assert!(back.invalid_rows.is_empty());
        assert!(back.unknown_columns.is_empty());

        // Handmade book with an unknown column "メモ2".
        let (_dir2, h) = tmp();
        handmade(&h, true, false);
        let book = read_project_book(&h).unwrap();
        assert_eq!(book.unknown_columns, vec!["メモ2".to_string()]);
        assert_eq!(book.tasks.len(), 3);
        assert_eq!(
            book.tasks[0].extra.get("メモ2").map(String::as_str),
            Some("x1")
        );

        let out = h.with_file_name("out.xlsx");
        write_project_book(&out, &book, d(2026, 10, 14), &[]).unwrap();
        let again = read_project_book(&out).unwrap();
        assert_eq!(again.unknown_columns, vec!["メモ2".to_string()]);
        assert_eq!(again.tasks, book.tasks);
        assert_eq!(again.tasks[2].extra["メモ2"], "x3");
    }

    #[test]
    fn invalid_date_cell_is_reported_not_dropped() {
        let (_dir, p) = tmp();
        handmade(&p, false, true);
        let book = read_project_book(&p).unwrap();
        assert_eq!(book.tasks.len(), 2);
        assert_eq!(book.invalid_rows.len(), 1);
        let bad = &book.invalid_rows[0];
        assert_eq!(bad.row, 3);
        assert_eq!(bad.no, Some(2));
        assert_eq!(bad.column, "終了");
        assert_eq!(bad.value, "来週");
        assert!(book.tasks.iter().all(|t| t.no != 2));

        let out = p.with_file_name("out.xlsx");
        write_project_book(&out, &book, d(2026, 10, 14), &[]).unwrap();
        let again = read_project_book(&out).unwrap();
        assert_eq!(again.tasks, book.tasks);
        assert_eq!(again.invalid_rows.len(), 1);
        let bad = &again.invalid_rows[0];
        assert_eq!(bad.column, "終了");
        assert_eq!(bad.value, "来週");
        assert_eq!(bad.no, Some(2));
        // The rest of the bad row survives too, with its types (start is still a date).
        let cells = again.invalid_cells.get(&bad.row).unwrap();
        assert_eq!(cells[3], RawCell::Text("見積り".into()));
        assert_eq!(cells[7], RawCell::DateTime(dt("2026-10-12T00:00")));
        assert_eq!(cells[0], RawCell::Number(2.0));
    }

    #[test]
    fn qiita_layout_file_is_readable() {
        let (_dir, p) = tmp();
        handmade(&p, false, false);
        let book = read_project_book(&p).unwrap();
        assert!(book.invalid_rows.is_empty());
        assert!(book.unknown_columns.is_empty());
        assert_eq!(book.sections, vec!["今週".to_string(), "来週".to_string()]);
        assert_eq!(book.assignees, vec!["たろう".to_string()]);
        assert_eq!(book.project, "仕事");
        assert_eq!(book.tasks.len(), 3);
        let t = &book.tasks[0];
        assert_eq!(t.no, 1);
        assert_eq!(t.title, "企画書");
        assert_eq!(t.category.as_deref(), Some("今週"));
        assert_eq!(t.priority, Priority(1));
        assert_eq!(t.progress, 50);
        assert_eq!(t.start, Some(d(2026, 10, 12)));
        assert_eq!(t.due, Some(d(2026, 10, 14)));
        assert_eq!(t.due_time, None);
        assert_eq!(t.days, Some(3));
        assert_eq!(t.note.as_deref(), Some("メモ"));
        // Extension columns take their defaults.
        assert_eq!(t.parent_no, None);
        assert!(t.labels.is_empty());
        assert_eq!(t.rrule, None);
        assert!(t.reminders.is_empty());
        assert_eq!(t.completed_at, None);
        assert_eq!(t.created_at, created_at_sentinel());
        assert_eq!(book.tasks[1].priority, Priority(2));
        assert_eq!(book.tasks[2].priority, Priority(3));
        assert_eq!(
            book.tasks.iter().map(|t| t.order).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn write_is_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("good.xlsx");
        let b = book(three_tasks());
        write_project_book(&good, &b, d(2026, 10, 14), &[]).unwrap();
        let before = std::fs::read(&good).unwrap();

        // Overwriting an existing file replaces it completely.
        let mut changed = b.clone();
        changed.tasks.pop();
        write_project_book(&good, &changed, d(2026, 10, 14), &[]).unwrap();
        assert_eq!(read_project_book(&good).unwrap().tasks.len(), 2);

        // A target that is a directory cannot be replaced: Err, nothing damaged, no temp files.
        let blocked = dir.path().join("blocked.xlsx");
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(blocked.join("keep.txt"), "x").unwrap();
        let res = write_project_book(&blocked, &b, d(2026, 10, 14), &[]);
        assert!(res.is_err());
        assert!(blocked.is_dir());
        assert!(blocked.join("keep.txt").exists());
        let mut names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["blocked.xlsx", "good.xlsx"]);
        assert_ne!(std::fs::read(&good).unwrap(), before);
    }

    #[test]
    fn priority_mapping_round_trip() {
        let (_dir, p) = tmp();
        let tasks: Vec<Task> = (1..=4)
            .map(|n| {
                let mut t = base_task(n, "t");
                t.priority = Priority(n as u8);
                t
            })
            .collect();
        write_project_book(&p, &book(tasks.clone()), d(2026, 10, 14), &[]).unwrap();
        let back = read_project_book(&p).unwrap();
        assert_eq!(
            back.tasks.iter().map(|t| t.priority.0).collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
        assert_eq!(back.tasks, tasks);
    }

    #[test]
    fn due_time_round_trips_as_datetime() {
        let (_dir, p) = tmp();
        let mut with_time = base_task(1, "会議");
        with_time.due = Some(d(2026, 10, 15));
        with_time.due_time = Some(NaiveTime::from_hms_opt(9, 5, 0).unwrap());
        let mut date_only = base_task(2, "提出");
        date_only.due = Some(d(2026, 10, 16));
        write_project_book(
            &p,
            &book(vec![with_time.clone(), date_only.clone()]),
            d(2026, 10, 14),
            &[],
        )
        .unwrap();
        let back = read_project_book(&p).unwrap();
        assert_eq!(back.tasks[0].due, with_time.due);
        assert_eq!(back.tasks[0].due_time, with_time.due_time);
        assert_eq!(back.tasks[1].due, date_only.due);
        assert_eq!(back.tasks[1].due_time, None);
    }

    #[test]
    fn empty_rows_are_skipped() {
        let (_dir, p) = tmp();
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.set_name(TASK_SHEET).unwrap();
        write_headers(ws, &QIITA_HEADERS);
        ws.write_number(1, 0, 1.0).unwrap();
        ws.write_string(1, 3, "あ").unwrap();
        // Row 3: blank except for whitespace and a project name.
        ws.write_string(2, 1, "仕事").unwrap();
        ws.write_string(2, 3, "  ").unwrap();
        // Row 5: a task after a gap.
        ws.write_number(4, 0, 2.0).unwrap();
        ws.write_string(4, 3, "い").unwrap();
        wb.save(&p).unwrap();
        let book = read_project_book(&p).unwrap();
        assert!(book.invalid_rows.is_empty());
        assert_eq!(
            book.tasks
                .iter()
                .map(|t| t.title.as_str())
                .collect::<Vec<_>>(),
            vec!["あ", "い"]
        );
        // No 設定 sheet: lists are empty, not an error.
        assert!(book.sections.is_empty());
        assert!(book.assignees.is_empty());
    }

    #[test]
    fn out_of_range_date_serial_is_invalid_row() {
        let (_dir, p) = tmp();
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.set_name(TASK_SHEET).unwrap();
        write_headers(ws, &QIITA_HEADERS);
        ws.write_number(1, 0, 1.0).unwrap();
        ws.write_string(1, 3, "あ").unwrap();
        ws.write_number_with_format(1, 8, -1e12, &date_fmt())
            .unwrap();
        wb.save(&p).unwrap();

        let book = read_project_book(&p).unwrap();
        assert!(book.tasks.is_empty());
        assert_eq!(book.invalid_rows.len(), 1);
        assert_eq!(book.invalid_rows[0].column, "終了");
        assert_eq!(book.invalid_rows[0].no, Some(1));
        assert_eq!(book.invalid_cells[&2][C_DUE], RawCell::Number(-1e12));

        // Written back unchanged (as a number) and still reported.
        let out = p.with_file_name("out.xlsx");
        write_project_book(&out, &book, d(2026, 10, 14), &[]).unwrap();
        let again = read_project_book(&out).unwrap();
        assert_eq!(again.invalid_rows.len(), 1);
        assert_eq!(again.invalid_cells[&2][C_DUE], RawCell::Number(-1e12));
    }

    #[test]
    fn unknown_column_values_keep_their_cell_types() {
        let (_dir, p) = tmp();
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.set_name(TASK_SHEET).unwrap();
        write_headers(ws, &["No.", "タスク", "期日2", "日時2", "済", "数"]);
        ws.write_number(1, 0, 1.0).unwrap();
        ws.write_string(1, 1, "あ").unwrap();
        ws.write_datetime_with_format(1, 2, d(2026, 10, 20), &date_fmt())
            .unwrap();
        let dt_fmt = rust_xlsxwriter::Format::new().set_num_format("yyyy-mm-dd hh:mm");
        ws.write_datetime_with_format(1, 3, dt("2026-10-20T09:30"), &dt_fmt)
            .unwrap();
        ws.write_boolean(1, 4, true).unwrap();
        ws.write_number(1, 5, 3.0).unwrap();
        wb.save(&p).unwrap();

        let book = read_project_book(&p).unwrap();
        let extra = &book.tasks[0].extra;
        assert_eq!(extra["期日2"], "2026-10-20");
        assert_eq!(extra["日時2"], "2026-10-20 09:30");
        assert_eq!(extra["済"], "TRUE");

        let out = p.with_file_name("out.xlsx");
        write_project_book(&out, &book, d(2026, 10, 14), &[]).unwrap();
        let mut back: Xlsx<_> = open_workbook(&out).unwrap();
        let range = back.worksheet_range(TASK_SHEET).unwrap();
        let base = HEADERS.len() as u32;
        let cell = |c: u32| range.get_value((1, base + c)).unwrap().clone();
        assert!(matches!(cell(0), Data::DateTime(_)), "{:?}", cell(0));
        assert_eq!(cells::text(&cell(0)), "2026-10-20");
        assert!(matches!(cell(1), Data::DateTime(_)), "{:?}", cell(1));
        assert_eq!(cells::text(&cell(1)), "2026-10-20 09:30");
        assert_eq!(cell(2), Data::Bool(true));
        assert_eq!(cell(3), Data::Float(3.0));
        assert_eq!(read_project_book(&out).unwrap().tasks, book.tasks);
    }

    #[test]
    fn days_skip_holidays_round_trip() {
        let (_dir, p) = tmp();
        let holidays = [d(2026, 10, 14)];
        let mut t = base_task(1, "週の作業");
        t.start = Some(d(2026, 10, 12));
        t.due = Some(d(2026, 10, 16));
        write_project_book(&p, &book(vec![t.clone()]), d(2026, 10, 14), &holidays).unwrap();
        let back = read_project_book(&p).unwrap();
        // Mon..Fri is 5 business days; the Wednesday holiday is skipped.
        assert_eq!(back.tasks[0].days, Some(4));
        t.days = Some(4);
        assert_eq!(back.tasks, vec![t]);
    }

    #[test]
    fn parent_no_zero_is_invalid() {
        let (_dir, p) = tmp();
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.set_name(TASK_SHEET).unwrap();
        write_headers(ws, &["No.", "タスク", "親No."]);
        ws.write_number(1, 0, 1.0).unwrap();
        ws.write_string(1, 1, "あ").unwrap();
        ws.write_number(1, 2, 0.0).unwrap();
        wb.save(&p).unwrap();
        let book = read_project_book(&p).unwrap();
        assert!(book.tasks.is_empty());
        assert_eq!(book.invalid_rows.len(), 1);
        assert_eq!(book.invalid_rows[0].column, "親No.");
        assert_eq!(book.invalid_rows[0].value, "0");
    }

    #[test]
    fn pre_1900_extra_date_text_stays_text() {
        let (_dir, p) = tmp();
        let mut t = base_task(1, "あ");
        t.extra.insert("古い日付".into(), "1850-01-01".into());
        let b = ProjectBook {
            unknown_columns: vec!["古い日付".into()],
            ..book(vec![t])
        };
        write_project_book(&p, &b, d(2026, 10, 14), &[]).unwrap();
        let back = read_project_book(&p).unwrap();
        assert_eq!(back.tasks[0].extra["古い日付"], "1850-01-01");
        let mut wb: Xlsx<_> = open_workbook(&p).unwrap();
        let range = wb.worksheet_range(TASK_SHEET).unwrap();
        let cell = range.get_value((1, HEADERS.len() as u32)).unwrap();
        assert!(matches!(cell, Data::String(_)), "{cell:?}");
    }
}
