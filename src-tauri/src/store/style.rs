//! Formats and sheet layout for the generated task sheet.

use rust_xlsxwriter::{
    Color, ConditionalFormatFormula, DataValidation, Format, FormatBorder, Formula, Worksheet,
    XlsxError,
};

use super::project_book::SETTINGS_SHEET;

/// Data rows below the last task that still get conditional formats and drop-downs, so rows a
/// user adds by hand in Excel look the same. 0-based index of the last covered row.
const MIN_COVERED_LAST_ROW: u32 = 999;

/// Last column of the known A..R block (0-based).
const LAST_KNOWN_COL: u16 = 17;

pub const DATE_FORMAT: &str = "yyyy-mm-dd";
pub const DATETIME_FORMAT: &str = "yyyy-mm-dd hh:mm";

pub fn header_format() -> Format {
    Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0xD9E2F3))
        .set_border(FormatBorder::Thin)
}

pub fn date_format() -> Format {
    Format::new().set_num_format(DATE_FORMAT)
}

pub fn datetime_format() -> Format {
    Format::new().set_num_format(DATETIME_FORMAT)
}

/// Column widths in characters, A..R.
const WIDTHS: [f64; 18] = [
    6.0, 12.0, 12.0, 40.0, 10.0, 8.0, 8.0, 12.0, 16.0, 6.0, 30.0, 10.0, 10.0, 10.0, 10.0, 10.0,
    16.0, 16.0,
];

/// Settings-sheet range of a list: header in row 4, values from row 5 (1-based), 30 rows
/// reserved like the Qiita sheet.
pub fn settings_list_formula(col_letter: char) -> Formula {
    Formula::new(format!(
        "OFFSET('{s}'!${c}$5,0,0,MAX(1,COUNTA('{s}'!${c}$5:${c}$1004)),1)",
        s = SETTINGS_SHEET,
        c = col_letter
    ))
}

/// Column widths, frozen header, autofilter, the two conditional formats and the drop-downs
/// for カテゴリ / 担当 / 優先度. `last_row` is the 0-based index of the last data row.
pub fn apply_task_sheet_layout(ws: &mut Worksheet, last_row: u32) -> Result<(), XlsxError> {
    for (col, width) in WIDTHS.iter().enumerate() {
        ws.set_column_width(col as u16, *width)?;
    }
    ws.set_column_format(7, &date_format())?;
    ws.set_column_format(8, &date_format())?;
    ws.set_column_format(16, &datetime_format())?;
    ws.set_column_format(17, &datetime_format())?;

    ws.set_freeze_panes(1, 0)?;
    ws.autofilter(0, 0, last_row.max(1), LAST_KNOWN_COL)?;

    let covered = last_row.max(MIN_COVERED_LAST_ROW);

    // Progress = 100: grey strike-through for the whole row.
    let done = ConditionalFormatFormula::new()
        .set_rule("=$G2=100")
        .set_format(
            Format::new()
                .set_font_color(Color::RGB(0x808080))
                .set_font_strikethrough(),
        );
    ws.add_conditional_format(1, 0, covered, LAST_KNOWN_COL, &done)?;

    // Overdue and not done: red due cell.
    let overdue = ConditionalFormatFormula::new()
        .set_rule("=AND($I2<TODAY(),$I2<>\"\",$G2<100)")
        .set_format(Format::new().set_font_color(Color::RGB(0xC00000)));
    ws.add_conditional_format(1, 8, covered, 8, &overdue)?;

    // Drop-downs fed by the settings sheet (C カテゴリ, E 担当, F 優先度).
    for (col, list_col) in [(2u16, 'F'), (4, 'G'), (5, 'H')] {
        let validation = DataValidation::new().allow_list_formula(settings_list_formula(list_col));
        ws.add_data_validation(1, col, covered, col, &validation)?;
    }
    Ok(())
}
