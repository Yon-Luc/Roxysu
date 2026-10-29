//! Pure watchdog policy: measurements in → optional breach reason out.
//!
//! Age is optional (`max_age_sec = None`). Prefer a user-level service
//! `Restart=` policy over relying on the age cap for normal operation.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Thresholds {
    /// `None` disables the age check (preferred for long soaks / systemd Restart).
    pub max_age_sec: Option<u64>,
    pub max_fds: u64,
    /// Descendant-only tree RSS in MiB (C-compatible; host excluded).
    pub max_rss_mb: u64,
    /// Optional cgroup `memory.current` cap in MiB.
    pub max_cgroup_mb: Option<u64>,
    /// Consecutive breaching samples required before exit (anti-noise).
    pub breach_samples: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Measurement {
    pub age_sec: u64,
    /// Max open FDs among host descendants (not the host).
    pub max_descendant_fds: u64,
    pub descendant_rss_mb: u64,
    /// Full tree including host (logged only).
    pub tree_rss_mb: u64,
    pub cgroup_mb: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreachReason {
    MaxAge,
    DescendantFdCap,
    DescendantRssCap,
    CgroupMemoryCap,
}

impl BreachReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MaxAge => "max age",
            Self::DescendantFdCap => "descendant fd cap",
            Self::DescendantRssCap => "descendant rss cap",
            Self::CgroupMemoryCap => "cgroup memory cap",
        }
    }
}

/// Evaluate one sample. Does not apply consecutive-sample hysteresis.
pub fn evaluate(m: &Measurement, t: &Thresholds) -> Option<BreachReason> {
    if let Some(cap) = t.max_age_sec {
        if m.age_sec > cap {
            return Some(BreachReason::MaxAge);
        }
    }
    if m.max_descendant_fds > t.max_fds {
        return Some(BreachReason::DescendantFdCap);
    }
    if m.descendant_rss_mb > t.max_rss_mb {
        return Some(BreachReason::DescendantRssCap);
    }
    if let (Some(cap), Some(cur)) = (t.max_cgroup_mb, m.cgroup_mb) {
        if cur > cap {
            return Some(BreachReason::CgroupMemoryCap);
        }
    }
    None
}

/// Tracks consecutive identical (or any) breaches before declaring action.
#[derive(Debug, Default)]
pub struct BreachWindow {
    streak: u32,
    last: Option<BreachReason>,
}

impl BreachWindow {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one evaluation result. Returns `Some(reason)` only when
    /// `breach_samples` consecutive breaches have been seen.
    pub fn observe(
        &mut self,
        reason: Option<BreachReason>,
        breach_samples: u32,
    ) -> Option<BreachReason> {
        let need = breach_samples.max(1);
        match reason {
            None => {
                self.streak = 0;
                self.last = None;
                None
            }
            Some(r) => {
                if self.last == Some(r) {
                    self.streak = self.streak.saturating_add(1);
                } else {
                    self.last = Some(r);
                    self.streak = 1;
                }
                if self.streak >= need {
                    Some(r)
                } else {
                    None
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thr() -> Thresholds {
        Thresholds {
            max_age_sec: Some(1800),
            max_fds: 450,
            max_rss_mb: 4200,
            max_cgroup_mb: None,
            breach_samples: 3,
        }
    }

    fn ok_meas() -> Measurement {
        Measurement {
            age_sec: 60,
            max_descendant_fds: 40,
            descendant_rss_mb: 800,
            tree_rss_mb: 850,
            cgroup_mb: None,
        }
    }

    #[test]
    fn healthy_sample_is_ok() {
        assert_eq!(evaluate(&ok_meas(), &thr()), None);
    }

    #[test]
    fn age_disabled_when_none() {
        let mut t = thr();
        t.max_age_sec = None;
        let mut m = ok_meas();
        m.age_sec = 10_000;
        assert_eq!(evaluate(&m, &t), None);
    }

    #[test]
    fn age_breach() {
        let mut m = ok_meas();
        m.age_sec = 1801;
        assert_eq!(evaluate(&m, &thr()), Some(BreachReason::MaxAge));
    }

    #[test]
    fn fd_and_rss_breach_priority_age_first() {
        let mut m = ok_meas();
        m.age_sec = 2000;
        m.max_descendant_fds = 500;
        assert_eq!(evaluate(&m, &thr()), Some(BreachReason::MaxAge));
        m.age_sec = 10;
        assert_eq!(evaluate(&m, &thr()), Some(BreachReason::DescendantFdCap));
        m.max_descendant_fds = 10;
        m.descendant_rss_mb = 5000;
        assert_eq!(evaluate(&m, &thr()), Some(BreachReason::DescendantRssCap));
    }

    #[test]
    fn cgroup_cap() {
        let mut t = thr();
        t.max_cgroup_mb = Some(2000);
        let mut m = ok_meas();
        m.cgroup_mb = Some(2500);
        assert_eq!(evaluate(&m, &t), Some(BreachReason::CgroupMemoryCap));
    }

    #[test]
    fn consecutive_window_requires_n() {
        let mut w = BreachWindow::new();
        assert_eq!(w.observe(Some(BreachReason::MaxAge), 3), None);
        assert_eq!(w.observe(Some(BreachReason::MaxAge), 3), None);
        assert_eq!(
            w.observe(Some(BreachReason::MaxAge), 3),
            Some(BreachReason::MaxAge)
        );
    }

    #[test]
    fn window_resets_on_healthy_or_reason_change() {
        let mut w = BreachWindow::new();
        assert_eq!(w.observe(Some(BreachReason::MaxAge), 3), None);
        assert_eq!(w.observe(None, 3), None);
        assert_eq!(w.observe(Some(BreachReason::MaxAge), 3), None);
        assert_eq!(
            w.observe(Some(BreachReason::DescendantRssCap), 3),
            None
        ); // streak reset to 1
        assert_eq!(w.observe(Some(BreachReason::DescendantRssCap), 3), None);
        assert_eq!(
            w.observe(Some(BreachReason::DescendantRssCap), 3),
            Some(BreachReason::DescendantRssCap)
        );
    }
}
