//! The blobs of attachments (spec attachments §2): `_attachments/<sha256>.<ext>`. A file is named by
//! its content and never rewritten, so two PCs that attach the same picture share one file and the
//! sync only copies what one side lacks. The name, type and size shown to the user live in the
//! comment records ([`crate::store::comments`]), not in the file name.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::store::paths::{Paths, write_atomic};
use crate::sync::sha256_hex;

pub const DIR: &str = "_attachments";

/// One file at most (spec §4 gives 50 MB for what is not an image; the backend holds every file to it,
/// as the sync keeps a file in memory).
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;

/// One attachment as the records and the screens carry it (spec §3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentInfo {
    /// SHA-256 of the content, 64 lower-case hex characters.
    pub hash: String,
    /// Lower-case extension without the dot, `""` when the original name had none.
    pub ext: String,
    /// The name the user knows it by.
    pub name: String,
    /// MIME type, `""` when unknown.
    #[serde(rename = "type")]
    pub mime: String,
    pub size: u64,
    /// Pixels, for images only (the thumbnail's frame is taken before the file is read).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<u32>,
}

/// What the settings show (spec §8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub count: u32,
    pub bytes: u64,
}

fn is_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_ext(s: &str) -> bool {
    (1..=16).contains(&s.len()) && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'z'))
}

/// `3f2a….png`, or just the hash when there is no extension.
pub fn file_name(hash: &str, ext: &str) -> String {
    if ext.is_empty() {
        hash.to_string()
    } else {
        format!("{hash}.{ext}")
    }
}

/// The inverse of [`file_name`]; `None` for anything else (temporary files, strangers).
pub fn parse_file_name(name: &str) -> Option<(String, String)> {
    let (hash, ext) = name.split_once('.').unwrap_or((name, ""));
    if !is_hash(hash) || (!ext.is_empty() && !is_ext(ext)) {
        return None;
    }
    Some((hash.to_string(), ext.to_string()))
}

/// The extension of a file name as `_attachments/` keeps it: after the last dot, lower-cased; `""`
/// when it is missing or not a plain short word.
pub fn ext_of(name: &str) -> String {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    if is_ext(&ext) { ext } else { String::new() }
}

/// The path of a blob. A hash or extension that is not what [`file_name`] makes is refused, so no
/// path comes out of the page's input.
pub fn path(paths: &Paths, hash: &str, ext: &str) -> AppResult<PathBuf> {
    if !is_hash(hash) || (!ext.is_empty() && !is_ext(ext)) {
        return Err(AppError::Invalid {
            message: "添付の指定が正しくありません".into(),
        });
    }
    Ok(paths.attachments_dir().join(file_name(hash, ext)))
}

/// Stores `bytes` and describes them. The bytes are kept as they are (the screen shrinks images before
/// it sends them). The same content is stored once. Written under a temporary name and renamed, so
/// a failure leaves no half file under the real name.
pub fn add(
    paths: &Paths,
    bytes: &[u8],
    name: &str,
    mime: &str,
    wh: Option<(u32, u32)>,
) -> AppResult<AttachmentInfo> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(AppError::Invalid {
            message: format!(
                "「{name}」は大きすぎるため付けられません (1 件 {} MB まで)",
                MAX_BYTES / 1024 / 1024
            ),
        });
    }
    let hash = sha256_hex(bytes);
    let ext = ext_of(name);
    let dest = path(paths, &hash, &ext)?;
    if !dest.exists() {
        std::fs::create_dir_all(paths.attachments_dir())?;
        write_atomic(&dest, bytes)?;
    }
    Ok(AttachmentInfo {
        hash,
        ext,
        name: name.to_string(),
        mime: mime.to_string(),
        size: bytes.len() as u64,
        w: wh.map(|(w, _)| w),
        h: wh.map(|(_, h)| h),
    })
}

/// The blob's content; a missing file is `NotFound` (not arrived yet, or lost).
pub fn read(paths: &Paths, hash: &str, ext: &str) -> AppResult<Vec<u8>> {
    match std::fs::read(path(paths, hash, ext)?) {
        Ok(b) => Ok(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(AppError::NotFound {
            message: "添付のファイルが見つかりません".into(),
        }),
        Err(e) => Err(e.into()),
    }
}

pub fn exists(paths: &Paths, hash: &str, ext: &str) -> bool {
    path(paths, hash, ext).is_ok_and(|p| p.is_file())
}

/// Number and total size of the blobs on this device (spec §8). Other files in the folder do not count.
pub fn usage(paths: &Paths) -> AppResult<Usage> {
    let entries = match std::fs::read_dir(paths.attachments_dir()) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Usage::default()),
        Err(e) => return Err(e.into()),
    };
    let mut u = Usage::default();
    for e in entries.flatten() {
        let Ok(name) = e.file_name().into_string() else {
            continue;
        };
        if parse_file_name(&name).is_none() {
            continue;
        }
        if let Ok(meta) = e.metadata()
            && meta.is_file()
        {
            u.count += 1;
            u.bytes += meta.len();
        }
    }
    Ok(u)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> (tempfile::TempDir, Paths) {
        let tmp = tempfile::tempdir().unwrap();
        let p = Paths::new(tmp.path());
        (tmp, p)
    }

    #[test]
    fn file_names_round_trip() {
        let h = "a".repeat(64);
        assert_eq!(file_name(&h, "png"), format!("{h}.png"));
        assert_eq!(file_name(&h, ""), h);
        assert_eq!(
            parse_file_name(&file_name(&h, "png")),
            Some((h.clone(), "png".into()))
        );
        assert_eq!(parse_file_name(&h), Some((h.clone(), String::new())));
        // Temporary names, upper case, short hashes and a second dot are not blobs.
        assert_eq!(parse_file_name(&format!("{h}.png.part")), None);
        assert_eq!(parse_file_name(&format!("{}.png", "A".repeat(64))), None);
        assert_eq!(parse_file_name("abc.png"), None);
        assert_eq!(parse_file_name(".powertodo-x.tmp"), None);
    }

    #[test]
    fn the_extension_comes_from_the_name() {
        assert_eq!(ext_of("写真.PNG"), "png");
        assert_eq!(ext_of("memo"), "");
        assert_eq!(ext_of("a.tar.gz"), "gz");
        assert_eq!(ext_of("x.日本語"), "", "not a plain word");
        assert_eq!(ext_of(&format!("x.{}", "a".repeat(17))), "");
    }

    #[test]
    fn add_names_the_file_by_its_hash_and_keeps_the_bytes() {
        let (_t, p) = paths();
        let info = add(&p, b"hello", "メモ.TXT", "text/plain", None).unwrap();
        assert_eq!(info.hash, sha256_hex(b"hello"));
        assert_eq!((info.ext.as_str(), info.size), ("txt", 5));
        assert_eq!(info.name, "メモ.TXT");
        assert_eq!(read(&p, &info.hash, "txt").unwrap(), b"hello");
        assert!(
            p.attachments_dir()
                .join(format!("{}.txt", info.hash))
                .is_file()
        );
    }

    #[test]
    fn the_same_content_is_stored_once() {
        let (_t, p) = paths();
        let a = add(&p, b"same", "a.png", "image/png", Some((2, 3))).unwrap();
        let b = add(&p, b"same", "b.png", "image/png", Some((2, 3))).unwrap();
        assert_eq!(a.hash, b.hash);
        assert_eq!((a.w, a.h), (Some(2), Some(3)));
        assert_eq!(usage(&p).unwrap(), Usage { count: 1, bytes: 4 });
    }

    #[test]
    fn no_temporary_file_stays_behind() {
        let (_t, p) = paths();
        add(&p, b"x", "a.png", "image/png", None).unwrap();
        add(&p, b"x", "a.png", "image/png", None).unwrap();
        let names: Vec<String> = std::fs::read_dir(p.attachments_dir())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
        assert!(parse_file_name(&names[0]).is_some());
    }

    #[test]
    fn a_failed_write_leaves_nothing_under_the_name() {
        let (_t, p) = paths();
        // `_attachments` is a file: the folder cannot be made.
        std::fs::write(p.attachments_dir(), b"x").unwrap();
        assert!(add(&p, b"x", "a.png", "image/png", None).is_err());
        assert!(p.attachments_dir().is_file());
    }

    #[test]
    fn a_file_over_the_cap_is_refused() {
        let (_t, p) = paths();
        let big = vec![0u8; MAX_BYTES as usize + 1];
        assert!(matches!(
            add(&p, &big, "big.bin", "", None),
            Err(AppError::Invalid { .. })
        ));
        assert!(!p.attachments_dir().exists());
        let ok = vec![0u8; MAX_BYTES as usize];
        assert!(add(&p, &ok, "ok.bin", "", None).is_ok());
    }

    #[test]
    fn a_path_cannot_come_out_of_the_input() {
        let (_t, p) = paths();
        assert!(path(&p, "../x", "png").is_err());
        assert!(path(&p, &"a".repeat(64), "../x").is_err());
        assert!(matches!(
            read(&p, &"a".repeat(64), "png"),
            Err(AppError::NotFound { .. })
        ));
    }

    #[test]
    fn usage_counts_blobs_only() {
        let (_t, p) = paths();
        assert_eq!(usage(&p).unwrap(), Usage::default());
        add(&p, b"abc", "a.png", "", None).unwrap();
        add(&p, b"de", "b", "", None).unwrap();
        std::fs::write(p.attachments_dir().join("stray.txt"), b"zzzz").unwrap();
        assert_eq!(usage(&p).unwrap(), Usage { count: 2, bytes: 5 });
    }

    #[test]
    fn info_serializes_as_the_spec_says() {
        let info = AttachmentInfo {
            hash: "h".into(),
            ext: "png".into(),
            name: "a.png".into(),
            mime: "image/png".into(),
            size: 3,
            w: Some(1),
            h: Some(2),
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["type"], "image/png");
        let none = AttachmentInfo {
            w: None,
            h: None,
            ..info
        };
        assert!(serde_json::to_value(&none).unwrap().get("w").is_none());
    }
}
