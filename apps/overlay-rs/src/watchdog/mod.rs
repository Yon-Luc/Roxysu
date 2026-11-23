//! Phase 6 — watchdog and lifecycle recovery.
//!
//! Scans off the GTK main loop. Requires repeated breaching samples before
//! exit. Uses a **non-zero** exit code so `Restart=on-failure` works.
//!
//! Related lifecycle (already elsewhere):
//! - WebKit reload backoff — [`crate::reload`]
//! - HUD load-fail vs web-process crash — distinct log lines in overlay
//! - Focus disconnect / reconnect — [`crate::focus`]
//!
//! D-NEW-1: a main-loop [`Heartbeat`] lets the scan treat a wedged GTK
//! loop (a visually dead HUD in a live process) as a breach, so the same
//! exit-75 path hands it to the desktop's liveness respawn.

mod heartbeat;
mod policy;
mod runner;
mod scan;

pub use heartbeat::{Heartbeat, HEARTBEAT_PERIOD};
pub use policy::Thresholds;
pub use runner::{start, WatchdogHandle};
