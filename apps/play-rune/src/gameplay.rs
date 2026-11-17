//! Mania gameplay engine (simplified port of apps/play GameplayEngine).

use crate::chart::{Chart, NoteKind};
use crate::judge::{Judgment, JudgmentCounts, judge_error, mania_hit_windows};

#[derive(Clone, Debug)]
struct NoteState {
    index: usize,
    column: u8,
    start_ms: f64,
    end_ms: f64,
    is_hold: bool,
    head_judged: bool,
    tail_judged: bool,
    holding: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum InputKind {
    Press,
    Release,
}

#[derive(Clone, Copy, Debug)]
pub struct InputEvent {
    pub lane: u8,
    pub time_ms: f64,
    pub kind: InputKind,
}

#[derive(Clone, Debug)]
pub struct GameplaySnapshot {
    pub song_time_ms: f64,
    pub combo: u32,
    pub max_combo: u32,
    pub score: u32,
    pub accuracy: f32,
    pub counts: JudgmentCounts,
    pub finished: bool,
    pub last_judgment: Option<Judgment>,
    pub last_judgment_lane: Option<u8>,
    /// Increments on every judgment so the playfield can spawn hit feedback once.
    pub judgment_seq: u64,
}

pub struct GameplayEngine {
    notes: Vec<NoteState>,
    queues: Vec<Vec<usize>>,
    heads: Vec<usize>,
    counts: JudgmentCounts,
    combo: u32,
    max_combo: u32,
    score: u32,
    column_count: u8,
    miss_window: f64,
    overall_difficulty: f32,
    finished: bool,
    last_note_end_ms: f64,
    hidden: Vec<bool>,
    last_judgment: Option<Judgment>,
    last_judgment_lane: Option<u8>,
    judgment_seq: u64,
}

impl GameplayEngine {
    pub fn load(chart: &Chart) -> Self {
        let windows = mania_hit_windows(chart.overall_difficulty);
        let column_count = chart.column_count;
        let mut notes = Vec::with_capacity(chart.notes.len());
        let mut queues = vec![Vec::new(); column_count as usize];
        let mut last_note_end_ms: f64 = 0.0;

        for (i, n) in chart.notes.iter().enumerate() {
            let is_hold = n.kind == NoteKind::Hold;
            let end_ms = if is_hold { n.end_ms } else { n.start_ms };
            notes.push(NoteState {
                index: i,
                column: n.column,
                start_ms: n.start_ms,
                end_ms,
                is_hold,
                head_judged: false,
                tail_judged: !is_hold,
                holding: false,
            });
            queues[n.column as usize].push(i);
            last_note_end_ms = last_note_end_ms.max(end_ms);
        }

        Self {
            notes,
            queues,
            heads: vec![0; column_count as usize],
            counts: JudgmentCounts::default(),
            combo: 0,
            max_combo: 0,
            score: 0,
            column_count,
            miss_window: windows.miss,
            overall_difficulty: chart.overall_difficulty,
            finished: false,
            last_note_end_ms,
            hidden: vec![false; chart.notes.len()],
            last_judgment: None,
            last_judgment_lane: None,
            judgment_seq: 0,
        }
    }

    pub fn update(&mut self, time_ms: f64, inputs: &[InputEvent]) {
        if self.finished {
            return;
        }
        self.miss_expired(time_ms);
        for input in inputs {
            match input.kind {
                InputKind::Press => self.on_press(input.lane, input.time_ms),
                InputKind::Release => self.on_release(input.lane, input.time_ms),
            }
        }
        if time_ms > self.last_note_end_ms + self.miss_window + 500.0 {
            self.flush_remaining(time_ms);
            self.finished = true;
        }
    }

    pub fn snapshot(&self, time_ms: f64) -> GameplaySnapshot {
        GameplaySnapshot {
            song_time_ms: time_ms,
            combo: self.combo,
            max_combo: self.max_combo,
            score: self.score,
            accuracy: self.counts.accuracy(),
            counts: self.counts.clone(),
            finished: self.finished,
            last_judgment: self.last_judgment,
            last_judgment_lane: self.last_judgment_lane,
            judgment_seq: self.judgment_seq,
        }
    }

    pub fn is_hidden(&self, index: usize) -> bool {
        self.hidden.get(index).copied().unwrap_or(false)
    }

    pub fn note_count(&self) -> usize {
        self.notes.len()
    }

    pub fn column_count(&self) -> u8 {
        self.column_count
    }

    fn windows(&self) -> crate::judge::HitWindows {
        mania_hit_windows(self.overall_difficulty)
    }

    fn on_press(&mut self, lane: u8, time_ms: f64) {
        let Some(idx) = self.next_unjudged_head(lane, time_ms) else {
            return;
        };
        let error = time_ms - self.notes[idx].start_ms;
        let result = judge_error(error.abs(), self.windows());
        self.notes[idx].head_judged = true;
        if self.notes[idx].is_hold && result != Judgment::Miss {
            self.notes[idx].holding = true;
        } else if self.notes[idx].is_hold {
            self.notes[idx].tail_judged = true;
        }
        self.apply(idx, result, false);
    }

    fn on_release(&mut self, lane: u8, time_ms: f64) {
        let Some(idx) = self.find_held(lane) else {
            return;
        };
        self.notes[idx].holding = false;
        self.notes[idx].tail_judged = true;
        let error = time_ms - self.notes[idx].end_ms;
        let mut result = judge_error(error.abs(), self.windows());
        if time_ms < self.notes[idx].end_ms - self.windows().meh {
            if result != Judgment::Miss {
                result = Judgment::Meh;
            }
        }
        self.apply(idx, result, true);
    }

    fn apply(&mut self, index: usize, result: Judgment, _tail: bool) {
        self.counts.add(result);
        self.last_judgment = Some(result);
        self.last_judgment_lane = Some(self.notes[index].column);
        self.judgment_seq = self.judgment_seq.wrapping_add(1);
        if result == Judgment::Miss {
            self.combo = 0;
        } else {
            self.combo += 1;
            self.max_combo = self.max_combo.max(self.combo);
            self.score += result.weight();
        }
        let note = &self.notes[index];
        if !note.is_hold {
            self.hidden[index] = note.head_judged;
        }
    }

    fn next_unjudged_head(&mut self, col: u8, time_ms: f64) -> Option<usize> {
        let col = col as usize;
        let mut h = self.heads[col];
        while h < self.queues[col].len() {
            let idx = self.queues[col][h];
            if self.notes[idx].head_judged {
                h += 1;
                continue;
            }
            if time_ms < self.notes[idx].start_ms - self.miss_window {
                self.heads[col] = h;
                return None;
            }
            if time_ms > self.notes[idx].start_ms + self.miss_window {
                let is_hold = self.notes[idx].is_hold;
                self.notes[idx].head_judged = true;
                if is_hold {
                    self.notes[idx].tail_judged = true;
                }
                self.apply(idx, Judgment::Miss, false);
                if !is_hold {
                    self.hidden[idx] = true;
                }
                h += 1;
                continue;
            }
            self.heads[col] = h;
            return Some(idx);
        }
        self.heads[col] = h;
        None
    }

    fn find_held(&self, col: u8) -> Option<usize> {
        for &idx in &self.queues[col as usize] {
            let note = &self.notes[idx];
            if note.holding && !note.tail_judged {
                return Some(idx);
            }
        }
        None
    }

    fn miss_expired(&mut self, time_ms: f64) {
        for col in 0..self.column_count {
            let _ = self.next_unjudged_head(col, time_ms);
            let q = self.queues[col as usize].clone();
            for idx in q {
                let note = &self.notes[idx];
                if !note.is_hold || note.tail_judged {
                    continue;
                }
                if note.head_judged && time_ms > note.end_ms + self.miss_window {
                    self.notes[idx].tail_judged = true;
                    self.notes[idx].holding = false;
                    self.apply(idx, Judgment::Miss, true);
                }
            }
        }
    }

    fn flush_remaining(&mut self, _time_ms: f64) {
        for i in 0..self.notes.len() {
            if !self.notes[i].head_judged {
                self.notes[i].head_judged = true;
                self.apply(i, Judgment::Miss, false);
            }
            if self.notes[i].is_hold && !self.notes[i].tail_judged {
                self.notes[i].tail_judged = true;
                self.apply(i, Judgment::Miss, true);
            }
        }
    }
}
