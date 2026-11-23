//! Bounded, coalescing focus command queue (L3).
//!
//! The Wayland/dispatch thread must never block on the GTK main loop, and the
//! queue must not grow without limit when the main loop is busy (the old
//! `async_channel::unbounded` did both badly). A one-slot wake channel plus a
//! single "latest command" slot bounds memory: a producer that finds a wake
//! already pending replaces the slot instead of enqueuing a second command.
//! `Show`/`Hide` are level-triggered, so only the newest state matters.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tracing::debug;

use super::FocusCommand;

/// One token in flight is enough: the slot carries the actual command.
const WAKE_CAPACITY: usize = 1;

/// Create the producer half used by the Wayland thread and the consumer half
/// polled from the GTK main loop.
pub fn focus_queue() -> (FocusSender, FocusQueue) {
    let (tx, rx) = async_channel::bounded(WAKE_CAPACITY);
    let slot = Arc::new(Mutex::new(None));
    (
        FocusSender {
            tx,
            slot: Arc::clone(&slot),
            coalesced: Arc::new(AtomicU64::new(0)),
        },
        FocusQueue { rx, slot },
    )
}

/// Non-blocking producer. Cloning is cheap and safe across threads.
#[derive(Clone)]
pub struct FocusSender {
    tx: async_channel::Sender<()>,
    slot: Arc<Mutex<Option<FocusCommand>>>,
    /// Replaced-before-consumed counter, for occasional debug logging.
    coalesced: Arc<AtomicU64>,
}

impl FocusSender {
    /// Store `cmd` as the newest command and wake the consumer, without ever
    /// blocking. When the wake channel is full a wake is already queued and
    /// the consumer will read the slot we just wrote, so nothing is lost.
    pub fn post(&self, cmd: FocusCommand) {
        let replaced = {
            let mut slot = self.slot.lock().unwrap_or_else(|err| err.into_inner());
            slot.replace(cmd).is_some()
        };
        if replaced {
            let n = self.coalesced.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 32 == 0 {
                debug!(
                    coalesced = n,
                    "coalesced focus commands before the main loop consumed them"
                );
            }
        }
        match self.tx.try_send(()) {
            Ok(()) | Err(async_channel::TrySendError::Full(())) => {}
            Err(async_channel::TrySendError::Closed(())) => {
                debug!("focus command queue closed; dropping command");
            }
        }
    }

    /// True once the consumer half is gone. Tests only.
    #[cfg(test)]
    pub fn is_closed(&self) -> bool {
        self.tx.is_closed()
    }
}

/// Consumer half, polled with [`FocusQueue::recv`] from the GTK thread.
pub struct FocusQueue {
    rx: async_channel::Receiver<()>,
    slot: Arc<Mutex<Option<FocusCommand>>>,
}

impl FocusQueue {
    /// Wait for the next command. `None` means the producer side is gone and
    /// no command was left in the slot.
    pub async fn recv(&self) -> Option<FocusCommand> {
        loop {
            if self.rx.recv().await.is_err() {
                // The producer side is gone; still deliver a command that
                // was posted before it exited.
                return self.take();
            }
            if let Some(cmd) = self.take() {
                return Some(cmd);
            }
        }
    }

    fn take(&self) -> Option<FocusCommand> {
        let mut slot = self.slot.lock().unwrap_or_else(|err| err.into_inner());
        slot.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::focus::OutputHint;

    fn poll(queue: &FocusQueue) -> Option<FocusCommand> {
        // The channel has a token whenever the slot may be non-empty.
        let rx = &queue.rx;
        let slot = &queue.slot;
        if rx.try_recv().is_err() {
            return None;
        }
        slot.lock().unwrap().take()
    }

    #[test]
    fn delivers_the_latest_command() {
        let (tx, rx) = focus_queue();
        tx.post(FocusCommand::Show {
            output: Some(OutputHint::Name("DP-1".into())),
        });
        assert_eq!(
            poll(&rx),
            Some(FocusCommand::Show {
                output: Some(OutputHint::Name("DP-1".into()))
            })
        );
        assert_eq!(poll(&rx), None);
    }

    #[test]
    fn coalesces_while_a_wake_is_pending() {
        let (tx, rx) = focus_queue();
        tx.post(FocusCommand::Show {
            output: Some(OutputHint::Name("DP-1".into())),
        });
        tx.post(FocusCommand::Show {
            output: Some(OutputHint::Name("DP-2".into())),
        });
        tx.post(FocusCommand::Hide);
        // One wake token, one (latest) command: bounded, never a backlog.
        assert_eq!(poll(&rx), Some(FocusCommand::Hide));
        assert_eq!(poll(&rx), None);
    }

    #[test]
    fn producer_never_blocks_after_the_receiver_is_dropped() {
        let (tx, rx) = focus_queue();
        drop(rx);
        // No panic, no block: the closed wake channel is logged and skipped.
        tx.post(FocusCommand::Hide);
        assert!(tx.is_closed());
    }
}
