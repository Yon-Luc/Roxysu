//! Read-only local mirror queries for mania song select.

use rusqlite::{Connection, OpenFlags, params};

use crate::paths::local_mirror_path;

#[derive(Clone, Debug)]
pub struct BeatmapRow {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub difficulty: String,
    pub keys: u8,
    pub stars: f32,
    pub hash: String,
    /// SHA-256 of the audio blob in lazer `files/` (when present).
    pub audio_file_hash: Option<String>,
    pub overall_difficulty: f32,
    pub length_ms: f32,
}

#[derive(Clone, Debug)]
pub struct CatalogStatus {
    pub db_path: String,
    pub ok: bool,
    pub message: String,
    pub total_mania_7k: u32,
    pub listed: u32,
}

const LIST_LIMIT: u32 = 200;

pub fn open_mirror() -> Result<Connection, String> {
    let path = local_mirror_path();
    if !path.is_file() {
        return Err(format!("local mirror missing: {}", path.display()));
    }
    Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("open {}: {e}", path.display()))
}

pub fn load_mania_7k(limit: u32) -> Result<(CatalogStatus, Vec<BeatmapRow>), String> {
    let path = local_mirror_path();
    let conn = open_mirror()?;
    let total: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM beatmaps
             WHERE ruleset_short_name = 'mania'
               AND circle_size = 7
               AND hash IS NOT NULL
               AND hash != ''
               AND hidden = 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let mut stmt = conn
        .prepare(
            "SELECT id, title, artist, difficulty_name, circle_size, star_rating, hash,
                    audio_file_hash, overall_difficulty, length
             FROM beatmaps
             WHERE ruleset_short_name = 'mania'
               AND circle_size = 7
               AND hash IS NOT NULL
               AND hash != ''
               AND hidden = 0
             ORDER BY title COLLATE NOCASE ASC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![limit], |r| {
            let audio = r.get::<_, Option<String>>(7)?;
            let audio_file_hash = audio.and_then(|h| {
                let t = h.trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            });
            Ok(BeatmapRow {
                id: r.get::<_, String>(0)?,
                title: r.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(untitled)".into()),
                artist: r.get::<_, Option<String>>(2)?.unwrap_or_else(|| "(unknown)".into()),
                difficulty: r
                    .get::<_, Option<String>>(3)?
                    .unwrap_or_else(|| "Normal".into()),
                keys: r.get::<_, Option<f64>>(4)?.unwrap_or(7.0) as u8,
                stars: r.get::<_, f64>(5)? as f32,
                hash: r.get::<_, String>(6)?,
                audio_file_hash,
                overall_difficulty: r.get::<_, Option<f64>>(8)?.unwrap_or(8.0) as f32,
                length_ms: r.get::<_, f64>(9)? as f32,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let listed = rows.len() as u32;
    Ok((
        CatalogStatus {
            db_path: path.display().to_string(),
            ok: true,
            message: format!("local mirror · {total} mania 7K · showing {listed}"),
            total_mania_7k: total,
            listed,
        },
        rows,
    ))
}

pub fn load_default() -> (CatalogStatus, Vec<BeatmapRow>) {
    match load_mania_7k(LIST_LIMIT) {
        Ok(v) => v,
        Err(message) => (
            CatalogStatus {
                db_path: local_mirror_path().display().to_string(),
                ok: false,
                message,
                total_mania_7k: 0,
                listed: 0,
            },
            Vec::new(),
        ),
    }
}

pub fn get_by_id(id: &str) -> Result<BeatmapRow, String> {
    let conn = open_mirror()?;
    conn.query_row(
        "SELECT id, title, artist, difficulty_name, circle_size, star_rating, hash,
                audio_file_hash, overall_difficulty, length
         FROM beatmaps WHERE id = ?1",
        params![id],
        |r| {
            let audio = r.get::<_, Option<String>>(7)?;
            let audio_file_hash = audio.and_then(|h| {
                let t = h.trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            });
            Ok(BeatmapRow {
                id: r.get(0)?,
                title: r.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(untitled)".into()),
                artist: r.get::<_, Option<String>>(2)?.unwrap_or_else(|| "(unknown)".into()),
                difficulty: r
                    .get::<_, Option<String>>(3)?
                    .unwrap_or_else(|| "Normal".into()),
                keys: r.get::<_, Option<f64>>(4)?.unwrap_or(7.0) as u8,
                stars: r.get::<_, f64>(5)? as f32,
                hash: r.get(6)?,
                audio_file_hash,
                overall_difficulty: r.get::<_, Option<f64>>(8)?.unwrap_or(8.0) as f32,
                length_ms: r.get::<_, f64>(9)? as f32,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod mirror_tests {
    use super::*;
    use crate::chart::load_chart_from_hash;

    #[test]
    fn loads_first_listed_chart_from_lazer_files() {
        let (status, rows) = load_default();
        assert!(status.ok, "{}", status.message);
        assert!(!rows.is_empty());
        let row = &rows[0];
        let chart = load_chart_from_hash(&row.hash, row.overall_difficulty)
            .unwrap_or_else(|e| panic!("hash {} — {e}", row.hash));
        assert_eq!(chart.column_count, 7);
        assert!(!chart.notes.is_empty());
        eprintln!("loaded {} notes for {}", chart.notes.len(), row.title);
    }
}
