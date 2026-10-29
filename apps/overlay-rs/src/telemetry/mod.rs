//! Phase 5 — observation-only RAM / resource telemetry.
//!
//! Samples off the GTK main loop. Does **not** terminate the process
//! (watchdog enforcement is Phase 6).

pub mod cgroup;
pub mod procfs;
mod sample;
mod sampling;
pub mod tree;

pub use sampling::{start, SamplerHandle};
