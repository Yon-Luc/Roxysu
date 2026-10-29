//! Event-driven Wayland focus tracking (Phase 4).
//!
//! - [`matching`] — C-compatible match policy (`contains` default, optional `exact`)
//! - [`reducer`] — pure Show/Hide state machine, flushed once per dispatch batch
//! - [`wayland`] — dedicated foreign-toplevel connection off the GTK thread

mod matching;
mod reducer;
mod wayland;

pub use matching::{MatchMode, MatchPolicy};
pub use wayland::{run_focus_loop, run_list_windows, FocusEvent};

#[derive(Debug, Clone)]
pub enum FocusCommand {
    Show,
    Hide,
    /// Connection dropped after a successful session; leave visibility unchanged.
    Disconnected,
    /// First connect failed (no protocol / no display); fall back to always-visible.
    Unavailable,
}
