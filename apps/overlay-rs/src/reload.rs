//! Single-slot WebKit reload / backoff state machine (Phase 3).
//!
//! C stacked independent `g_timeout_add` calls from load-failed and
//! web-process-terminated. This machine keeps at most one pending timer.

use std::time::Duration;

pub const WEB_PROCESS_RELOAD_DELAY: Duration = Duration::from_secs(1);
pub const LOAD_FAIL_DELAY: Duration = Duration::from_secs(3);
pub const LOAD_FAIL_BACKOFF_DELAY: Duration = Duration::from_secs(15);
pub const LOAD_FAIL_BACKOFF_AFTER: u32 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReloadTrigger {
    WebProcessTerminated,
    LoadFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScheduleResult {
    /// Arm a single timer; no other reload timer may be pending.
    Schedule { delay: Duration },
    /// A reload timer is already armed — ignore this trigger.
    AlreadyPending,
}

#[derive(Debug, Default)]
pub struct ReloadMachine {
    consecutive_load_failures: u32,
    /// True while a reload timer is scheduled but has not fired yet.
    pending: bool,
}

impl ReloadMachine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn consecutive_load_failures(&self) -> u32 {
        self.consecutive_load_failures
    }

    pub fn is_pending(&self) -> bool {
        self.pending
    }

    pub fn on_trigger(&mut self, trigger: ReloadTrigger) -> ScheduleResult {
        let delay = match trigger {
            ReloadTrigger::WebProcessTerminated => WEB_PROCESS_RELOAD_DELAY,
            ReloadTrigger::LoadFailed => {
                self.consecutive_load_failures = self.consecutive_load_failures.saturating_add(1);
                if self.consecutive_load_failures > LOAD_FAIL_BACKOFF_AFTER {
                    LOAD_FAIL_BACKOFF_DELAY
                } else {
                    LOAD_FAIL_DELAY
                }
            }
        };
        self.request(delay)
    }

    /// Timer fired: clear the slot, then caller should `load_uri`.
    pub fn on_timer_fired(&mut self) {
        self.pending = false;
    }

    /// Successful load finished: reset failure streak.
    pub fn on_load_finished(&mut self) {
        self.consecutive_load_failures = 0;
    }

    fn request(&mut self, delay: Duration) -> ScheduleResult {
        if self.pending {
            return ScheduleResult::AlreadyPending;
        }
        self.pending = true;
        ScheduleResult::Schedule { delay }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_process_schedules_one_second() {
        let mut m = ReloadMachine::new();
        assert_eq!(
            m.on_trigger(ReloadTrigger::WebProcessTerminated),
            ScheduleResult::Schedule {
                delay: WEB_PROCESS_RELOAD_DELAY
            }
        );
        assert!(m.is_pending());
        assert_eq!(
            m.on_trigger(ReloadTrigger::WebProcessTerminated),
            ScheduleResult::AlreadyPending
        );
        assert_eq!(
            m.on_trigger(ReloadTrigger::LoadFailed),
            ScheduleResult::AlreadyPending
        );
    }

    #[test]
    fn load_fail_backoff_after_five() {
        let mut m = ReloadMachine::new();
        for i in 1..=5 {
            let r = m.on_trigger(ReloadTrigger::LoadFailed);
            assert_eq!(
                r,
                ScheduleResult::Schedule {
                    delay: LOAD_FAIL_DELAY
                },
                "failure {i}"
            );
            m.on_timer_fired();
        }
        assert_eq!(m.consecutive_load_failures(), 5);
        assert_eq!(
            m.on_trigger(ReloadTrigger::LoadFailed),
            ScheduleResult::Schedule {
                delay: LOAD_FAIL_BACKOFF_DELAY
            }
        );
    }

    #[test]
    fn load_finished_resets_failures() {
        let mut m = ReloadMachine::new();
        let _ = m.on_trigger(ReloadTrigger::LoadFailed);
        m.on_timer_fired();
        assert_eq!(m.consecutive_load_failures(), 1);
        m.on_load_finished();
        assert_eq!(m.consecutive_load_failures(), 0);
        assert_eq!(
            m.on_trigger(ReloadTrigger::LoadFailed),
            ScheduleResult::Schedule {
                delay: LOAD_FAIL_DELAY
            }
        );
    }

    #[test]
    fn timer_clears_pending_so_next_can_schedule() {
        let mut m = ReloadMachine::new();
        assert!(matches!(
            m.on_trigger(ReloadTrigger::WebProcessTerminated),
            ScheduleResult::Schedule { .. }
        ));
        m.on_timer_fired();
        assert!(!m.is_pending());
        assert!(matches!(
            m.on_trigger(ReloadTrigger::LoadFailed),
            ScheduleResult::Schedule { .. }
        ));
    }
}
