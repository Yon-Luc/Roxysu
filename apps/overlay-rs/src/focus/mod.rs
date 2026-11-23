//! Event-driven Wayland focus tracking.
//!
//! - [`matching`] — `contains` default; title only when `app_id` is empty
//! - [`reducer`] — pure Show/Hide state machine, flushed once per dispatch batch
//! - [`wayland`] — `zwlr_foreign_toplevel_manager_v1`, else Plasma window management
//! - [`grant`] — KWin `.desktop` grant for the privileged Plasma global

mod grant;
mod matching;
mod plasma;
mod queue;
mod reducer;
mod wayland;

pub use grant::{install_plasma_grant, GrantOutcome};
pub use matching::{MatchMode, MatchPolicy};
pub use queue::focus_queue;
pub use reducer::{OutputHint, OutputRect};
pub use wayland::{run_list_windows, spawn_focus_loop, FocusEvent, FocusHandle};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusCommand {
    /// Matched window is activated. `output` is a pin hint when `--output` is unset.
    Show {
        output: Option<OutputHint>,
    },
    Hide,
    /// Connection dropped after a session that had a backend; leave visibility unchanged.
    Disconnected,
    /// No usable backend yet. Stay unmapped and keep retrying.
    Unavailable {
        reason: String,
    },
}

/// A missing focus protocol does not force the overlay visible.
/// Always-visible is only `--follow-focus=false`, which never reaches this path.
pub fn visibility_after_unavailable(currently_wants_visible: bool) -> bool {
    currently_wants_visible
}

#[cfg(test)]
mod tests {
    use super::visibility_after_unavailable;

    #[test]
    fn unavailable_does_not_force_visible() {
        assert!(!visibility_after_unavailable(false));
        assert!(visibility_after_unavailable(true));
    }
}
