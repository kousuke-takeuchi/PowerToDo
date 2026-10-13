//! Cell <-> value conversion for the xlsx store. Every calamine `Data` interpretation lives
//! here so `project_book` only deals with typed values.

use calamine::Data;
use chrono::{Duration, NaiveDate, NaiveDateTime, Timelike};

/// A cell value kept verbatim (type included) so rows we do not understand can be written back.
#[derive(Debug, Clone, PartialEq)]
pub enum RawCell {
    Empty,
    Text(String),
    Number(f64),
    DateTime(NaiveDateTime),
}

/// The cell holds something of the wrong type for the column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BadCell;

pub fn is_blank(d: &Data) -> bool {
    match d {
        Data::Empty => true,
        Data::String(s) => s.trim().is_empty(),
        _ => false,
    }
}

/// Number as Excel would show it in a General cell: no trailing `.0` for whole numbers.
pub fn number_text(f: f64) -> String {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

fn round_to_second(dt: NaiveDateTime) -> NaiveDateTime {
    let base = dt.with_nanosecond(0).unwrap_or(dt);
    if dt.nanosecond() >= 500_000_000 {
        base + Duration::seconds(1)
    } else {
        base
    }
}

/// Largest serial Excel accepts as a date (9999-12-31 23:59:59).
const MAX_EXCEL_SERIAL: f64 = 2_958_465.999_99;

/// Serial outside Excel's date range (or NaN / infinite) -> `None`. calamine's `as_datetime`
/// panics inside chrono for huge values, so it is only called for serials in range.
fn excel_datetime(e: &calamine::ExcelDateTime) -> Option<NaiveDateTime> {
    let f = e.as_f64();
    if !f.is_finite() || !(0.0..=MAX_EXCEL_SERIAL).contains(&f) {
        return None;
    }
    e.as_datetime().map(round_to_second)
}

fn datetime_text(dt: NaiveDateTime) -> String {
    if dt.time() == chrono::NaiveTime::MIN {
        dt.format("%Y-%m-%d").to_string()
    } else {
        dt.format("%Y-%m-%d %H:%M").to_string()
    }
}

/// Display text of any cell (what the user sees, roughly). Used for unknown columns and for
/// reporting bad values.
pub fn text(d: &Data) -> String {
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => number_text(*f),
        Data::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Data::DateTime(e) => match excel_datetime(e) {
            Some(dt) if e.is_datetime() => datetime_text(dt),
            _ => number_text(e.as_f64()),
        },
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{e}"),
    }
}

pub fn to_raw(d: &Data) -> RawCell {
    match d {
        Data::Empty => RawCell::Empty,
        Data::String(s) if s.is_empty() => RawCell::Empty,
        Data::String(s) => RawCell::Text(s.clone()),
        Data::Int(i) => RawCell::Number(*i as f64),
        Data::Float(f) => RawCell::Number(*f),
        Data::DateTime(e) if e.is_datetime() => match excel_datetime(e) {
            Some(dt) => RawCell::DateTime(dt),
            None => RawCell::Number(e.as_f64()),
        },
        Data::DateTime(e) => RawCell::Number(e.as_f64()),
        Data::DateTimeIso(s) => {
            parse_iso(s).map_or_else(|| RawCell::Text(s.clone()), RawCell::DateTime)
        }
        other => RawCell::Text(text(other)),
    }
}

/// Whole number. Blank -> `None`. Text, fractions and anything else -> `BadCell`.
pub fn integer(d: &Data) -> Result<Option<i64>, BadCell> {
    match d {
        _ if is_blank(d) => Ok(None),
        Data::Int(i) => Ok(Some(*i)),
        Data::Float(f) if f.fract() == 0.0 && f.abs() < 1e15 => Ok(Some(*f as i64)),
        _ => Err(BadCell),
    }
}

/// Date or date-time. Blank -> `None`. Text that is not an ISO date, plain numbers and
/// durations -> `BadCell`.
pub fn datetime(d: &Data) -> Result<Option<NaiveDateTime>, BadCell> {
    match d {
        _ if is_blank(d) => Ok(None),
        Data::DateTime(e) if e.is_datetime() => excel_datetime(e).map(Some).ok_or(BadCell),
        Data::DateTimeIso(s) => parse_iso(s).map(Some).ok_or(BadCell),
        _ => Err(BadCell),
    }
}

fn parse_iso(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim();
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(round_to_second(dt));
        }
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .map(|d| d.and_time(chrono::NaiveTime::MIN))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers() {
        assert_eq!(integer(&Data::Empty), Ok(None));
        assert_eq!(integer(&Data::String("  ".into())), Ok(None));
        assert_eq!(integer(&Data::Float(3.0)), Ok(Some(3)));
        assert_eq!(integer(&Data::Int(7)), Ok(Some(7)));
        assert_eq!(integer(&Data::Float(3.5)), Err(BadCell));
        assert_eq!(integer(&Data::String("3".into())), Err(BadCell));
    }

    #[test]
    fn texts() {
        assert_eq!(text(&Data::Float(3.0)), "3");
        assert_eq!(text(&Data::Float(2.5)), "2.5");
        assert_eq!(text(&Data::Bool(true)), "TRUE");
    }

    #[test]
    fn iso_dates() {
        let dt = datetime(&Data::DateTimeIso("2026-10-14".into()))
            .unwrap()
            .unwrap();
        assert_eq!(dt.to_string(), "2026-10-14 00:00:00");
        assert!(datetime(&Data::String("来週".into())).is_err());
        assert!(datetime(&Data::Float(46000.0)).is_err());
    }

    #[test]
    fn out_of_range_serials_are_bad_not_panics() {
        use calamine::{ExcelDateTime, ExcelDateTimeType};
        for v in [-1e12, -1.0, 2_958_466.0, 1e300, f64::NAN, f64::INFINITY] {
            let d = Data::DateTime(ExcelDateTime::new(v, ExcelDateTimeType::DateTime, false));
            assert_eq!(datetime(&d), Err(BadCell), "{v}");
            assert!(matches!(to_raw(&d), RawCell::Number(_)), "{v}");
            let _ = text(&d);
        }
        let ok = Data::DateTime(ExcelDateTime::new(
            2_958_465.0,
            ExcelDateTimeType::DateTime,
            false,
        ));
        assert_eq!(
            datetime(&ok).unwrap().unwrap().date(),
            NaiveDate::from_ymd_opt(9999, 12, 31).unwrap()
        );
    }

    #[test]
    fn iso_datetime_is_raw_datetime() {
        let dt = NaiveDate::from_ymd_opt(2026, 10, 14)
            .unwrap()
            .and_hms_opt(9, 30, 0)
            .unwrap();
        assert_eq!(
            to_raw(&Data::DateTimeIso("2026-10-14T09:30:00".into())),
            RawCell::DateTime(dt)
        );
        assert_eq!(
            to_raw(&Data::DateTimeIso("not a date".into())),
            RawCell::Text("not a date".into())
        );
    }
}
