use std::collections::BTreeMap;

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Deserializer, Serialize};

/// Name of the inbox project. Fixed and not deletable.
pub const INBOX: &str = "受信トレイ";

/// Generates a serde `with` module for a chrono type: strict canonical format on write,
/// canonical (plus optional extra) formats on read. Sub-modules: `option` (`Option<T>`) and
/// `nullable` (`Option<Option<T>>`, where a missing key is the outer `None` and JSON `null`
/// is `Some(None)`).
macro_rules! chrono_serde {
    ($name:ident, $ty:ty, $fmt:literal, [$($alt:literal),*]) => {
        pub mod $name {
            use super::*;
            use serde::{Deserializer, Serializer};

            fn parse(s: &str) -> Result<$ty, chrono::ParseError> {
                let first = <$ty>::parse_from_str(s, $fmt);
                if first.is_ok() {
                    return first;
                }
                $(
                    if let Ok(v) = <$ty>::parse_from_str(s, $alt) {
                        return Ok(v);
                    }
                )*
                first
            }

            pub fn serialize<S: Serializer>(v: &$ty, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(&v.format($fmt).to_string())
            }

            pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<$ty, D::Error> {
                let s = String::deserialize(d)?;
                parse(&s).map_err(serde::de::Error::custom)
            }

            pub mod option {
                use super::*;

                pub fn serialize<S: Serializer>(v: &Option<$ty>, s: S) -> Result<S::Ok, S::Error> {
                    match v {
                        Some(v) => super::serialize(v, s),
                        None => s.serialize_none(),
                    }
                }

                pub fn deserialize<'de, D: Deserializer<'de>>(
                    d: D,
                ) -> Result<Option<$ty>, D::Error> {
                    Option::<String>::deserialize(d)?
                        .map(|s| parse(&s).map_err(serde::de::Error::custom))
                        .transpose()
                }
            }

            pub mod nullable {
                use super::*;

                pub fn serialize<S: Serializer>(
                    v: &Option<Option<$ty>>,
                    s: S,
                ) -> Result<S::Ok, S::Error> {
                    match v {
                        Some(Some(v)) => super::serialize(v, s),
                        _ => s.serialize_none(),
                    }
                }

                pub fn deserialize<'de, D: Deserializer<'de>>(
                    d: D,
                ) -> Result<Option<Option<$ty>>, D::Error> {
                    super::option::deserialize(d).map(Some)
                }
            }
        }
    };
}

chrono_serde!(serde_date, NaiveDate, "%Y-%m-%d", []);
chrono_serde!(
    serde_datetime,
    NaiveDateTime,
    "%Y-%m-%dT%H:%M",
    ["%Y-%m-%dT%H:%M:%S"]
);
chrono_serde!(serde_time, NaiveTime, "%H:%M", ["%H:%M:%S"]);

/// Deserializer for patch fields where a missing key means "unchanged" (`None`, via
/// `#[serde(default)]`) and JSON `null` means "clear" (`Some(None)`).
pub fn deserialize_nullable<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// Priority 1 (highest) ..= 4 (none). Serialized as a bare number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct Priority(pub u8);

impl Default for Priority {
    fn default() -> Self {
        Priority(4)
    }
}

impl TryFrom<u8> for Priority {
    type Error = String;

    fn try_from(v: u8) -> Result<Self, Self::Error> {
        if (1..=4).contains(&v) {
            Ok(Priority(v))
        } else {
            Err(format!("priority must be 1..=4, got {v}"))
        }
    }
}

impl From<Priority> for u8 {
    fn from(p: Priority) -> u8 {
        p.0
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub no: u32,
    pub project: String,
    pub category: Option<String>,
    pub title: String,
    pub assignee: String,
    pub priority: Priority,
    pub progress: u8,
    #[serde(
        default,
        with = "serde_date::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub start: Option<NaiveDate>,
    #[serde(
        default,
        with = "serde_date::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub due: Option<NaiveDate>,
    #[serde(
        default,
        with = "serde_time::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub due_time: Option<NaiveTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub days: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_no: Option<u32>,
    pub labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rrule: Option<String>,
    pub reminders: Vec<String>,
    pub order: u32,
    #[serde(with = "serde_datetime")]
    pub created_at: NaiveDateTime,
    #[serde(
        default,
        with = "serde_datetime::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub completed_at: Option<NaiveDateTime>,
    /// Unknown xlsx columns (header -> cell text), kept for write-back. Not sent to the UI.
    #[serde(skip)]
    pub extra: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub color: String,
    pub order: u32,
    pub favorite: bool,
    pub inbox: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub project: String,
    pub name: String,
    pub order: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    pub color: String,
    pub order: u32,
}

/// A row whose cell types are broken (e.g. text in a date column). Reported, never rewritten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidRow {
    pub row: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no: Option<u32>,
    pub column: String,
    pub value: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub title: String,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub priority: Option<Priority>,
    #[serde(default, with = "serde_date::option")]
    pub due: Option<NaiveDate>,
    #[serde(default, with = "serde_time::option")]
    pub due_time: Option<NaiveTime>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub parent_no: Option<u32>,
}

/// Partial update. Every field is optional: outer `None` = unchanged. The fields that can be
/// cleared are `Option<Option<T>>`: `Some(None)` clears the value.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub category: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
    #[serde(
        default,
        with = "serde_date::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub start: Option<Option<NaiveDate>>,
    #[serde(
        default,
        with = "serde_date::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub due: Option<Option<NaiveDate>>,
    #[serde(
        default,
        with = "serde_time::nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub due_time: Option<Option<NaiveTime>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub note: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_no: Option<Option<u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub rrule: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminders: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, NaiveDateTime, NaiveTime};

    fn sample() -> Task {
        Task {
            no: 1,
            project: "仕事".into(),
            category: Some("今週".into()),
            title: "資料を作る".into(),
            assignee: "たろう".into(),
            priority: Priority(2),
            progress: 0,
            start: None,
            due: Some(NaiveDate::from_ymd_opt(2026, 10, 14).unwrap()),
            due_time: Some(NaiveTime::from_hms_opt(15, 0, 0).unwrap()),
            days: None,
            note: None,
            parent_no: None,
            labels: vec!["急ぎ".into()],
            rrule: None,
            reminders: vec![],
            order: 1,
            created_at: NaiveDateTime::parse_from_str("2026-10-10T09:00", "%Y-%m-%dT%H:%M")
                .unwrap(),
            completed_at: None,
            extra: BTreeMap::new(),
        }
    }

    #[test]
    fn task_json_shape() {
        let v = serde_json::to_value(sample()).unwrap();
        assert_eq!(v["due"], "2026-10-14");
        assert_eq!(v["dueTime"], "15:00");
        assert_eq!(v["createdAt"], "2026-10-10T09:00");
        assert_eq!(v["priority"], 2);
        assert!(v["priority"].is_number());
        assert_eq!(v["category"], "今週");
        // optional fields are omitted when None
        for k in [
            "start",
            "days",
            "note",
            "parentNo",
            "rrule",
            "completedAt",
            "extra",
        ] {
            assert!(v.get(k).is_none(), "{k} should be omitted");
        }
    }

    #[test]
    fn task_none_category_is_null() {
        let mut t = sample();
        t.category = None;
        let v = serde_json::to_value(t).unwrap();
        assert!(v["category"].is_null());
    }

    #[test]
    fn task_round_trip() {
        let mut t = sample();
        t.start = Some(NaiveDate::from_ymd_opt(2026, 10, 12).unwrap());
        t.parent_no = Some(7);
        t.completed_at =
            Some(NaiveDateTime::parse_from_str("2026-10-11T18:30", "%Y-%m-%dT%H:%M").unwrap());
        let json = serde_json::to_string(&t).unwrap();
        let back: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
    }

    #[test]
    fn priority_bounds() {
        assert!(serde_json::from_str::<Priority>("1").is_ok());
        assert!(serde_json::from_str::<Priority>("4").is_ok());
        assert!(serde_json::from_str::<Priority>("5").is_err());
        assert!(serde_json::from_str::<Priority>("0").is_err());
        assert_eq!(serde_json::to_string(&Priority(3)).unwrap(), "3");
        assert_eq!(Priority::default(), Priority(4));
    }

    #[test]
    fn patch_missing_vs_null() {
        let p: TaskPatch = serde_json::from_str(r#"{"title":"x"}"#).unwrap();
        assert_eq!(p.title.as_deref(), Some("x"));
        assert_eq!(p.due, None);
        assert_eq!(p.note, None);
        assert_eq!(p.parent_no, None);
        assert_eq!(p.start, None);
        assert_eq!(p.rrule, None);

        let p: TaskPatch = serde_json::from_str(
            r#"{"due":null,"dueTime":null,"note":null,"category":null,"parentNo":null,"start":null,"rrule":null}"#,
        )
        .unwrap();
        assert_eq!(p.start, Some(None));
        assert_eq!(p.rrule, Some(None));
        assert_eq!(p.due, Some(None));
        assert_eq!(p.due_time, Some(None));
        assert_eq!(p.note, Some(None));
        assert_eq!(p.category, Some(None));
        assert_eq!(p.parent_no, Some(None));

        let p: TaskPatch = serde_json::from_str(
            r#"{"due":"2026-10-20","dueTime":"09:30","note":"n","category":"c","parentNo":3,"start":"2026-10-15","rrule":"FREQ=WEEKLY"}"#,
        )
        .unwrap();
        assert_eq!(
            p.start,
            Some(Some(NaiveDate::from_ymd_opt(2026, 10, 15).unwrap()))
        );
        assert_eq!(p.rrule, Some(Some("FREQ=WEEKLY".to_string())));
        assert_eq!(
            p.due,
            Some(Some(NaiveDate::from_ymd_opt(2026, 10, 20).unwrap()))
        );
        assert_eq!(
            p.due_time,
            Some(Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()))
        );
        assert_eq!(p.note, Some(Some("n".to_string())));
        assert_eq!(p.category, Some(Some("c".to_string())));
        assert_eq!(p.parent_no, Some(Some(3)));
    }

    #[test]
    fn deserialize_nullable_generic() {
        #[derive(Deserialize)]
        struct W {
            #[serde(default, deserialize_with = "deserialize_nullable")]
            v: Option<Option<u32>>,
        }
        assert_eq!(serde_json::from_str::<W>("{}").unwrap().v, None);
        assert_eq!(
            serde_json::from_str::<W>(r#"{"v":null}"#).unwrap().v,
            Some(None)
        );
        assert_eq!(
            serde_json::from_str::<W>(r#"{"v":5}"#).unwrap().v,
            Some(Some(5))
        );
    }

    #[test]
    fn task_input_defaults() {
        let i: TaskInput = serde_json::from_str(r#"{"title":"買い物"}"#).unwrap();
        assert_eq!(i.title, "買い物");
        assert!(i.labels.is_empty());
        assert_eq!(i.due, None);
        let i: TaskInput = serde_json::from_str(
            r#"{"title":"a","priority":1,"due":"2026-10-14","dueTime":"15:00","parentNo":2,"section":"s"}"#,
        )
        .unwrap();
        assert_eq!(i.priority, Some(Priority(1)));
        assert_eq!(i.due_time, Some(NaiveTime::from_hms_opt(15, 0, 0).unwrap()));
        assert_eq!(i.parent_no, Some(2));
        assert_eq!(i.section.as_deref(), Some("s"));
    }

    #[test]
    fn date_formats_reject_garbage() {
        assert!(serde_json::from_str::<TaskInput>(r#"{"title":"a","due":"来週"}"#).is_err());
    }

    #[test]
    fn simple_structs_are_camel_case() {
        let v = serde_json::to_value(InvalidRow {
            row: 3,
            no: Some(2),
            column: "終了".into(),
            value: "来週".into(),
            message: "m".into(),
        })
        .unwrap();
        assert_eq!(v["row"], 3);
        assert_eq!(v["no"], 2);
        let v = serde_json::to_value(InvalidRow {
            row: 4,
            no: None,
            column: "c".into(),
            value: "v".into(),
            message: "m".into(),
        })
        .unwrap();
        assert!(v.get("no").is_none());
        let v = serde_json::to_value(Project {
            name: INBOX.into(),
            color: "#fff".into(),
            order: 0,
            favorite: false,
            inbox: true,
        })
        .unwrap();
        assert_eq!(v["inbox"], true);
        assert_eq!(v["name"], "受信トレイ");
    }
}
