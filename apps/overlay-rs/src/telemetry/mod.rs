//! Phase 5 — observation-only RAM / resource telemetry.
//!
//! Samples off the GTK main loop. Does **not** terminate the process
//! (watchdog enforcement is Phase 6).

mod cgroup;
mod procfs;
mod sample;
mod sampling;
mod tree;

pub use sampling::{start, SamplerHandle};
