//! Mania hit windows (port of `@roxysu/mania-judge` windows.ts).

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Judgment {
    Perfect,
    Great,
    Good,
    Ok,
    Meh,
    Miss,
}

impl Judgment {
    pub fn label(self) -> &'static str {
        match self {
            Self::Perfect => "PERFECT",
            Self::Great => "GREAT",
            Self::Good => "GOOD",
            Self::Ok => "OK",
            Self::Meh => "MEH",
            Self::Miss => "MISS",
        }
    }

    pub fn weight(self) -> u32 {
        match self {
            Self::Perfect => 305,
            Self::Great => 300,
            Self::Good => 200,
            Self::Ok => 100,
            Self::Meh => 50,
            Self::Miss => 0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct HitWindows {
    pub perfect: f64,
    pub great: f64,
    pub good: f64,
    pub ok: f64,
    pub meh: f64,
    pub miss: f64,
}

pub fn mania_hit_windows(od: f32) -> HitWindows {
    let od = f64::from(od);
    HitWindows {
        perfect: 16.0,
        great: (64.0 - 3.0 * od).trunc(),
        good: (97.0 - 3.0 * od).trunc(),
        ok: (127.0 - 3.0 * od).trunc(),
        meh: (151.0 - 3.0 * od).trunc(),
        miss: (178.0 - 3.0 * od).trunc(),
    }
}

pub fn judge_error(abs_error: f64, windows: HitWindows) -> Judgment {
    let err = abs_error.round();
    if err <= windows.perfect {
        Judgment::Perfect
    } else if err <= windows.great {
        Judgment::Great
    } else if err <= windows.good {
        Judgment::Good
    } else if err <= windows.ok {
        Judgment::Ok
    } else if err <= windows.meh {
        Judgment::Meh
    } else {
        Judgment::Miss
    }
}

#[derive(Clone, Debug, Default)]
pub struct JudgmentCounts {
    pub perfect: u32,
    pub great: u32,
    pub good: u32,
    pub ok: u32,
    pub meh: u32,
    pub miss: u32,
}

impl JudgmentCounts {
    pub fn add(&mut self, j: Judgment) {
        match j {
            Judgment::Perfect => self.perfect += 1,
            Judgment::Great => self.great += 1,
            Judgment::Good => self.good += 1,
            Judgment::Ok => self.ok += 1,
            Judgment::Meh => self.meh += 1,
            Judgment::Miss => self.miss += 1,
        }
    }

    pub fn accuracy(&self) -> f32 {
        let total_weight = self.perfect * 305
            + self.great * 300
            + self.good * 200
            + self.ok * 100
            + self.meh * 50;
        let judged =
            self.perfect + self.great + self.good + self.ok + self.meh + self.miss;
        if judged == 0 {
            1.0
        } else {
            total_weight as f32 / (judged as f32 * 305.0)
        }
    }
}
