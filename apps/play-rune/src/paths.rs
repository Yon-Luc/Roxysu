//! Resolve local mirror and osu!lazer data paths (mirrors `@roxysu/db` / `@roxysu/osu-paths`).

use std::path::PathBuf;

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Roxysu data directory: `ROXYSU_DATA_DIR`, else monorepo `apps/server` when present,
/// else `~/.local/share/roxysu`.
pub fn roxysu_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("ROXYSU_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let monorepo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/server");
    if monorepo.join("data.sqlite").is_file() {
        return monorepo;
    }
    home_dir().join(".local/share/roxysu")
}

pub fn local_mirror_path() -> PathBuf {
    if let Some(path) = std::env::var_os("DB_PATH") {
        return PathBuf::from(path);
    }
    roxysu_data_dir().join("data.sqlite")
}

/// osu!lazer data: `OSU_DATA_PATH`, else `~/.local/share/osu` on Linux.
pub fn osu_data_path() -> PathBuf {
    if let Some(path) = std::env::var_os("OSU_DATA_PATH") {
        return PathBuf::from(path);
    }
    if let Some(realm) = std::env::var_os("REALM_PATH") {
        if let Some(parent) = PathBuf::from(realm).parent() {
            return parent.to_path_buf();
        }
    }
    home_dir().join(".local/share/osu")
}

/// Lazer hashed `files/` blob path for a SHA-256 hex hash.
pub fn lazer_file_path(osu_data: &std::path::Path, hash: &str) -> PathBuf {
    let hash = hash.trim();
    let a = hash.get(0..1).unwrap_or("0");
    let b = hash.get(0..2).unwrap_or("00");
    osu_data.join("files").join(a).join(b).join(hash)
}
