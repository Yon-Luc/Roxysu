//! Minimal mania `.osu` parser (7K) for the Rune vertical slice.

use std::fs;
use std::path::Path;

use crate::paths::{lazer_file_path, osu_data_path};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteKind {
    Tap,
    Hold,
}

#[derive(Clone, Debug)]
pub struct ChartNote {
    pub column: u8,
    pub start_ms: f64,
    pub end_ms: f64,
    pub kind: NoteKind,
}

#[derive(Clone, Debug)]
pub struct Chart {
    pub column_count: u8,
    pub overall_difficulty: f32,
    pub notes: Vec<ChartNote>,
    pub title: String,
    /// From `.osu` General.AudioLeadIn (ms).
    pub audio_lead_in_ms: f64,
}

#[derive(Debug, thiserror::Error)]
pub enum ChartError {
    #[error("{0}")]
    Message(String),
}

pub fn load_chart_from_hash(hash: &str, overall_difficulty: f32) -> Result<Chart, ChartError> {
    let path = lazer_file_path(&osu_data_path(), hash);
    read_chart_file(&path, overall_difficulty)
}

pub fn read_chart_file(path: &Path, overall_difficulty: f32) -> Result<Chart, ChartError> {
    let text = fs::read_to_string(path).map_err(|e| {
        ChartError::Message(format!("read {}: {e}", path.display()))
    })?;
    parse_mania_osu(&text, overall_difficulty)
}

pub fn parse_mania_osu(text: &str, overall_difficulty: f32) -> Result<Chart, ChartError> {
    let mut mode: Option<i32> = None;
    let mut circle_size: Option<f32> = None;
    let mut audio_lead_in_ms = 0.0_f64;
    let mut title = String::from("Unknown");
    let mut section = String::new();
    let mut notes = Vec::new();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            continue;
        }
        match section.as_str() {
            "General" => {
                if let Some(v) = kv(line, "Mode") {
                    mode = v.parse().ok();
                }
                if let Some(v) = kv(line, "AudioLeadIn") {
                    if let Ok(ms) = v.parse::<f64>() {
                        audio_lead_in_ms = ms.max(0.0);
                    }
                }
            }
            "Difficulty" => {
                if let Some(v) = kv(line, "CircleSize") {
                    circle_size = v.parse().ok();
                }
            }
            "Metadata" => {
                if let Some(v) = kv(line, "Title") {
                    title = v.to_string();
                }
            }
            "HitObjects" => {
                if let Some(note) = parse_hit_object(line, circle_size.unwrap_or(7.0) as u8) {
                    notes.push(note);
                }
            }
            _ => {}
        }
    }

    if mode != Some(3) {
        return Err(ChartError::Message("beatmap mode is not mania".into()));
    }
    let keys = circle_size.unwrap_or(0.0).round() as u8;
    if keys != 7 {
        return Err(ChartError::Message(format!(
            "expected 7K chart, got {keys} keys"
        )));
    }
    if notes.is_empty() {
        return Err(ChartError::Message("beatmap contains no notes".into()));
    }

    notes.sort_by(|a, b| {
        a.start_ms
            .partial_cmp(&b.start_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.column.cmp(&b.column))
    });

    Ok(Chart {
        column_count: 7,
        overall_difficulty,
        notes,
        title,
        audio_lead_in_ms,
    })
}

fn kv<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let (k, v) = line.split_once(':')?;
    if k.trim() == key {
        Some(v.trim())
    } else {
        None
    }
}

fn parse_hit_object(line: &str, keys: u8) -> Option<ChartNote> {
    // x,y,time,type,hitSound[,endTime]:hitSample
    let mut parts = line.split(',');
    let x: f64 = parts.next()?.parse().ok()?;
    let _y = parts.next()?;
    let time: f64 = parts.next()?.parse().ok()?;
    let obj_type: u32 = parts.next()?.parse().ok()?;
    let _hitsound = parts.next()?;
    let rest = parts.next().unwrap_or("");

    let column = ((x * f64::from(keys)) / 512.0).floor() as i32;
    let column = column.clamp(0, i32::from(keys) - 1) as u8;

    // Hold if type bit 7 (128) set, or end time present and longer than tap.
    let is_hold_type = (obj_type & 128) != 0;
    let end_ms = if is_hold_type {
        rest.split(':')
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(time)
    } else {
        time
    };

    let kind = if is_hold_type && end_ms > time + 20.0 {
        NoteKind::Hold
    } else {
        NoteKind::Tap
    };

    Some(ChartNote {
        column,
        start_ms: time,
        end_ms: if kind == NoteKind::Hold { end_ms } else { time },
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_7k() {
        let osu = r#"
osu file format v14
[General]
Mode: 3
[Difficulty]
CircleSize:7
OverallDifficulty:8
[Metadata]
Title:Test
[HitObjects]
36,192,1000,1,0,0:0:0:0:
73,192,1200,128,0,1800:0:0:0:0:
"#;
        let chart = parse_mania_osu(osu, 8.0).expect("parse");
        assert_eq!(chart.column_count, 7);
        assert_eq!(chart.notes.len(), 2);
        assert_eq!(chart.notes[0].kind, NoteKind::Tap);
        assert_eq!(chart.notes[1].kind, NoteKind::Hold);
    }
}
