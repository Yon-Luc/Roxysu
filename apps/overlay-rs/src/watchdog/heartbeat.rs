//! Main-loop heartbeat (D-NEW-1).
//!
//! The GTK main loop stamps [`Heartbeat::beat`] from a periodic timeout; the
//! watchdog thread reads [`Heartbeat::stall`]. A stamp that stops advancing
//! means the main loop is wedged: the HUD cannot repaint, hide, or recreate
//! its WebView, but the process is still alive, so the desktop's
//! exit-driven liveness respawn never fires on its own.
//!
//! Visibility does not matter here. A hidden overlay (osu! unfocused) still
//! runs its timeouts, so only a real hang ages the stamp. Both sides use the
//! monotonic clock, which does not advance during system suspend, so a
//! resume does not look like a stall.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How often the main loop stamps the heartbeat.
pub const HEARTBEAT_PERIOD: Duration = Duration::from_secs(1);

/// Shared between the GTK main loop (writer) and the watchdog thread (reader).
#[derive(Clone, Debug)]
pub struct Heartbeat {
    origin: Instant,
    /// Milliseconds since `origin` at the last beat.
    last_ms: Arc<AtomicU64>,
}

impl Heartbeat {
    /// A new heartbeat counts as freshly beaten.
    pub fn new() -> Self {
        Self::with_origin(Instant::now())
    }

    fn with_origin(origin: Instant) -> Self {
        Self {
            origin,
            last_ms: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Stamp "the main loop turned now".
    pub fn beat(&self) {
        self.beat_at(Instant::now());
    }

    fn beat_at(&self, at: Instant) {
        let ms = at.saturating_duration_since(self.origin).as_millis();
        let ms = u64::try_from(ms).unwrap_or(u64::MAX);
        // fetch_max: a late writer can never move the stamp backwards.
        self.last_ms.fetch_max(ms, Ordering::Relaxed);
    }

    /// Time since the last beat, measured at `now`.
    pub fn stall_at(&self, now: Instant) -> Duration {
        let now_ms = now.saturating_duration_since(self.origin).as_millis();
        let now_ms = u64::try_from(now_ms).unwrap_or(u64::MAX);
        Duration::from_millis(now_ms.saturating_sub(self.last_ms.load(Ordering::Relaxed)))
    }

    /// Time since the last beat.
    pub fn stall(&self) -> Duration {
        self.stall_at(Instant::now())
    }
}

impl Default for Heartbeat {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_heartbeat_is_not_stalled() {
        let origin = Instant::now();
        let hb = Heartbeat::with_origin(origin);
        assert_eq!(hb.stall_at(origin), Duration::ZERO);
    }

    #[test]
    fn stall_grows_until_the_next_beat() {
        let origin = Instant::now();
        let hb = Heartbeat::with_origin(origin);
        let later = origin + Duration::from_secs(45);
        assert_eq!(hb.stall_at(later), Duration::from_secs(45));
        hb.beat_at(origin + Duration::from_secs(44));
        assert_eq!(hb.stall_at(later), Duration::from_secs(1));
    }

    #[test]
    fn a_stale_beat_never_moves_the_stamp_back() {
        let origin = Instant::now();
        let hb = Heartbeat::with_origin(origin);
        hb.beat_at(origin + Duration::from_secs(10));
        hb.beat_at(origin + Duration::from_secs(5));
        assert_eq!(
            hb.stall_at(origin + Duration::from_secs(12)),
            Duration::from_secs(2)
        );
    }

    #[test]
    fn clones_share_the_stamp() {
        let origin = Instant::now();
        let hb = Heartbeat::with_origin(origin);
        let reader = hb.clone();
        hb.beat_at(origin + Duration::from_secs(30));
        assert_eq!(
            reader.stall_at(origin + Duration::from_secs(31)),
            Duration::from_secs(1)
        );
    }
}
