//! Phase 6 — watchdog and lifecycle recovery.
//!
//! Scans off the GTK main loop. Requires repeated breaching samples before
//! exit. Uses a **non-zero** exit code so `Restart=on-failure` works.
//!
//! Related lifecycle (already elsewhere):
//! - WebKit reload backoff — [`crate::reload`]
//! - HUD load-fail vs web-process crash — distinct log lines in overlay
//! - Focus disconnect / reconnect — [`crate::focus`]

mod policy;
mod runner;
mod scan;

pub use policy::Thresholds;
pub use runner::{start, WatchdogHandle};
