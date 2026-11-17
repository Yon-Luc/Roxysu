//! Minimal mania skin loader for perf A/B (procedural fills vs PNG blit).
//!
//! Prefers `skin.ini` `[Mania]` `Keys: 7` `NoteImage*` / `KeyImage*` paths
//! (osu! uses `\`); falls back to flat `mania-noteN` names in the skin root.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::ImageReader;

use crate::paths::osu_data_path;

#[derive(Clone, Debug)]
pub struct RgbaSprite {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct PlaySkin {
    pub name: String,
    pub source: PathBuf,
    pub notes: [Option<RgbaSprite>; 7],
    pub bodies: [Option<RgbaSprite>; 7],
    pub keys_up: [Option<RgbaSprite>; 7],
    pub keys_down: [Option<RgbaSprite>; 7],
}

impl PlaySkin {
    pub fn note_count(&self) -> usize {
        self.notes.iter().filter(|n| n.is_some()).count()
    }
}

fn empty_sprites() -> [Option<RgbaSprite>; 7] {
    [None, None, None, None, None, None, None]
}

pub fn skins_root() -> PathBuf {
    if let Some(p) = std::env::var_os("ROXYSU_PLAY_SKIN_DIR") {
        return PathBuf::from(p);
    }
    osu_data_path().join("skins")
}

/// Prefer `ROXYSU_PLAY_SKIN`, else first installed skin folder with ≥1 note image.
pub fn load_preferred() -> Result<Arc<PlaySkin>, String> {
    if let Some(p) = std::env::var_os("ROXYSU_PLAY_SKIN") {
        return load_from_dir(Path::new(&p)).map(Arc::new);
    }
    let root = skins_root();
    let mut dirs = list_skin_dirs(&root);
    dirs.sort();
    let mut last_err = format!("no skin folders under {}", root.display());
    for dir in dirs {
        match load_from_dir(&dir) {
            Ok(skin) if skin.note_count() > 0 => return Ok(Arc::new(skin)),
            Ok(skin) => {
                last_err = format!(
                    "{}: skin.ini present but no 7K note images resolved",
                    skin.name
                );
            }
            Err(err) => last_err = err,
        }
    }
    Err(format!(
        "{last_err} (set ROXYSU_PLAY_SKIN to a folder; .osk not supported — unzip first)"
    ))
}

pub fn list_skin_dirs(root: &Path) -> Vec<PathBuf> {
    let Ok(rd) = fs::read_dir(root) else {
        return Vec::new();
    };
    rd.filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join("skin.ini").is_file())
        .collect()
}

pub fn load_from_dir(dir: &Path) -> Result<PlaySkin, String> {
    if !dir.is_dir() {
        return Err(format!("not a skin folder: {}", dir.display()));
    }
    let name = dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("skin")
        .to_string();

    let mut notes = empty_sprites();
    let mut bodies = empty_sprites();
    let mut keys_up = empty_sprites();
    let mut keys_down = empty_sprites();

    if let Some(map) = parse_mania7_images(dir) {
        for col in 0..7usize {
            if let Some(path) = map.notes[col].as_ref() {
                notes[col] = decode_rgba(path).ok();
            }
            if let Some(path) = map.bodies[col].as_ref() {
                bodies[col] = decode_rgba(path).ok();
            }
            if let Some(path) = map.keys_up[col].as_ref() {
                keys_up[col] = decode_rgba(path).ok();
            }
            if let Some(path) = map.keys_down[col].as_ref() {
                keys_down[col] = decode_rgba(path).ok();
            }
        }
    }

    // Flat-name fallback (simple skins / missing ini entries).
    for col in 0..7usize {
        let n = col + 1;
        if notes[col].is_none() {
            notes[col] = load_first(dir, &note_names(n));
        }
        if bodies[col].is_none() {
            bodies[col] = load_first(dir, &body_names(n));
        }
        if keys_up[col].is_none() {
            keys_up[col] = load_first(dir, &key_up_names(n));
        }
        if keys_down[col].is_none() {
            keys_down[col] = load_first(dir, &key_down_names(n));
        }
    }

    if let Some(first) = notes.iter().find_map(|n| n.clone()) {
        for slot in &mut notes {
            if slot.is_none() {
                *slot = Some(first.clone());
            }
        }
    }

    Ok(PlaySkin {
        name,
        source: dir.to_path_buf(),
        notes,
        bodies,
        keys_up,
        keys_down,
    })
}

struct Mania7Paths {
    notes: [Option<PathBuf>; 7],
    bodies: [Option<PathBuf>; 7],
    keys_up: [Option<PathBuf>; 7],
    keys_down: [Option<PathBuf>; 7],
}

fn parse_mania7_images(dir: &Path) -> Option<Mania7Paths> {
    let text = fs::read_to_string(dir.join("skin.ini")).ok()?;
    let mut section: Option<Vec<(String, String)>> = None;
    let mut best: Option<Vec<(String, String)>> = None;

    let flush = |section: &mut Option<Vec<(String, String)>>, best: &mut Option<Vec<(String, String)>>| {
        let Some(kv) = section.take() else {
            return;
        };
        let keys = kv
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("Keys"))
            .map(|(_, v)| v.trim());
        if keys == Some("7") {
            *best = Some(kv);
        }
    };

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("//") || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            flush(&mut section, &mut best);
            let name = &line[1..line.len() - 1];
            section = if name.eq_ignore_ascii_case("Mania") {
                Some(Vec::new())
            } else {
                None
            };
            continue;
        }
        if let Some(kv) = section.as_mut() {
            if let Some((k, v)) = line.split_once(':') {
                kv.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
    }
    flush(&mut section, &mut best);

    let kv = best?;
    let mut out = Mania7Paths {
        notes: empty_paths(),
        bodies: empty_paths(),
        keys_up: empty_paths(),
        keys_down: empty_paths(),
    };
    for (k, v) in kv {
        let Some(path) = resolve_ini_image(dir, &v) else {
            continue;
        };
        if let Some(col) = strip_prefix_num(&k, "NoteImage", "") {
            if col < 7 {
                out.notes[col] = Some(path);
            }
        } else if let Some(col) = strip_prefix_num(&k, "NoteImage", "H") {
            if col < 7 {
                out.bodies[col] = Some(path);
            }
        } else if let Some(col) = strip_prefix_num(&k, "KeyImage", "") {
            if col < 7 {
                out.keys_up[col] = Some(path);
            }
        } else if let Some(col) = strip_prefix_num(&k, "KeyImage", "D") {
            if col < 7 {
                out.keys_down[col] = Some(path);
            }
        }
    }
    Some(out)
}

fn empty_paths() -> [Option<PathBuf>; 7] {
    [None, None, None, None, None, None, None]
}

/// `NoteImage3H` → prefix NoteImage, suffix H → col 3
fn strip_prefix_num(key: &str, prefix: &str, suffix: &str) -> Option<usize> {
    let rest = key.strip_prefix(prefix)?;
    let num = if suffix.is_empty() {
        rest
    } else {
        rest.strip_suffix(suffix)?
    };
    // Avoid matching NoteImage0H when looking for NoteImage0 (suffix "").
    if suffix.is_empty() && num.chars().any(|c| !c.is_ascii_digit()) {
        return None;
    }
    num.parse().ok()
}

fn resolve_ini_image(dir: &Path, raw: &str) -> Option<PathBuf> {
    let rel = raw.replace('\\', "/").trim_matches('/').to_string();
    if rel.is_empty() {
        return None;
    }
    let base = dir.join(&rel);
    const EXTS: &[&str] = &["png", "jpg", "jpeg"];
    let stem = base.to_string_lossy();
    let candidates = {
        let mut v = vec![base.clone()];
        for ext in EXTS {
            v.push(PathBuf::from(format!("{stem}.{ext}")));
            v.push(PathBuf::from(format!("{stem}@2x.{ext}")));
        }
        v
    };
    for c in &candidates {
        if c.is_file() {
            return Some(c.clone());
        }
    }
    // Case-insensitive file in the same parent.
    let parent = base.parent()?;
    let stem = base.file_name()?.to_string_lossy().to_ascii_lowercase();
    let Ok(rd) = fs::read_dir(parent) else {
        return None;
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_ascii_lowercase();
        if name == stem
            || EXTS.iter().any(|ext| name == format!("{stem}.{ext}"))
            || EXTS
                .iter()
                .any(|ext| name == format!("{stem}@2x.{ext}"))
        {
            return Some(e.path());
        }
    }
    None
}

fn note_names(n: usize) -> Vec<String> {
    vec![
        format!("mania-note{n}"),
        format!("note-{n}"),
        format!("note{n}"),
    ]
}

fn body_names(n: usize) -> Vec<String> {
    vec![
        format!("mania-note{n}H"),
        format!("note-{n}H"),
        format!("note{n}H"),
    ]
}

fn key_up_names(n: usize) -> Vec<String> {
    vec![
        format!("mania-key{n}"),
        format!("key-{n}"),
        format!("key{n}"),
    ]
}

fn key_down_names(n: usize) -> Vec<String> {
    vec![
        format!("mania-key{n}D"),
        format!("key-{n}D"),
        format!("key{n}D"),
    ]
}

fn load_first(dir: &Path, bases: &[String]) -> Option<RgbaSprite> {
    for base in bases {
        if let Some(path) = resolve_image(dir, base) {
            if let Ok(sprite) = decode_rgba(&path) {
                return Some(sprite);
            }
        }
    }
    None
}

fn resolve_image(dir: &Path, base: &str) -> Option<PathBuf> {
    const EXTS: &[&str] = &["png", "jpg", "jpeg"];
    let mut names = Vec::new();
    for ext in EXTS {
        names.push(format!("{base}.{ext}"));
        names.push(format!("{base}@2x.{ext}"));
    }
    for name in &names {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return None;
    };
    let want: Vec<String> = names.iter().map(|n| n.to_ascii_lowercase()).collect();
    for e in rd.flatten() {
        let lower = e.file_name().to_string_lossy().to_ascii_lowercase();
        if want.iter().any(|w| w == &lower) {
            return Some(e.path());
        }
    }
    None
}

fn decode_rgba(path: &Path) -> Result<RgbaSprite, String> {
    let img = ImageReader::open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .with_guessed_format()
        .map_err(|e| format!("{}: {e}", path.display()))?
        .decode()
        .map_err(|e| format!("{}: {e}", path.display()))?
        .into_rgba8();
    let (width, height) = img.dimensions();
    Ok(RgbaSprite {
        width,
        height,
        rgba: img.into_raw(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_note_image_keys() {
        assert_eq!(strip_prefix_num("NoteImage3", "NoteImage", ""), Some(3));
        assert_eq!(strip_prefix_num("NoteImage3H", "NoteImage", "H"), Some(3));
        assert_eq!(strip_prefix_num("NoteImage3H", "NoteImage", ""), None);
        assert_eq!(strip_prefix_num("KeyImage0D", "KeyImage", "D"), Some(0));
    }

    #[test]
    fn loads_noy2027_from_default_osu_skins() {
        let dir = PathBuf::from("/home/yonluc/.local/share/osu/skins/noy2027");
        if !dir.is_dir() {
            return;
        }
        let skin = load_from_dir(&dir).expect("load noy2027");
        assert!(
            skin.note_count() >= 1,
            "expected notes from skin.ini Keys:7, got {}",
            skin.note_count()
        );
        assert!(
            skin.keys_up.iter().any(|k| k.is_some()),
            "expected key sprites"
        );
    }
}
