//! Process lifecycle helpers shared with the desktop shell's supervisor.
//!
//! * `UNSUPPORTED_EXIT_CODE` (78, `EX_CONFIG`): this session can never host the
//!   overlay (no Wayland display, no wlr-layer-shell). The shell parks the host
//!   instead of respawning it every few seconds (desktop DD-10).
//! * `watch_stdin_eof`: the shell spawns the host with a stdin pipe and
//!   `--exit-on-stdin-eof`. When the shell exits for any reason the pipe closes
//!   and the host exits too, instead of leaving its layer surface on screen
//!   (desktop DD-1).

use std::fmt;
use std::io::Read;

/// `EX_CONFIG` — the environment cannot run the overlay; do not respawn.
pub const UNSUPPORTED_EXIT_CODE: i32 = 78;

/// Startup failure caused by the session, not by the host.
#[derive(Debug)]
pub struct Unsupported(pub String);

impl fmt::Display for Unsupported {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Unsupported {}

/// Exit code for a startup error: 78 for an unsupported session, else 1.
pub fn exit_code_for(err: &anyhow::Error) -> i32 {
    if err.downcast_ref::<Unsupported>().is_some() {
        UNSUPPORTED_EXIT_CODE
    } else {
        1
    }
}

/// Run `on_eof` on a background thread once `reader` reaches EOF or fails.
/// Nothing read is interpreted — the pipe only signals "parent is gone".
pub fn watch_stdin_eof<R, F>(mut reader: R, on_eof: F) -> std::thread::JoinHandle<()>
where
    R: Read + Send + 'static,
    F: FnOnce() + Send + 'static,
{
    std::thread::Builder::new()
        .name("stdin-lifeline".into())
        .spawn(move || {
            let mut buf = [0u8; 256];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => continue,
                }
            }
            on_eof();
        })
        .expect("spawn stdin-lifeline thread")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    #[test]
    fn unsupported_maps_to_ex_config() {
        let err = anyhow::Error::new(Unsupported("no layer shell".into()));
        assert_eq!(exit_code_for(&err), 78);
        assert_eq!(err.to_string(), "no layer shell");
    }

    #[test]
    fn other_errors_map_to_one() {
        let err = anyhow::anyhow!("boom");
        assert_eq!(exit_code_for(&err), 1);
    }

    #[test]
    fn eof_fires_callback_after_draining() {
        let fired = Arc::new(AtomicBool::new(false));
        let f = Arc::clone(&fired);
        let reader = std::io::Cursor::new(b"ignored bytes".to_vec());
        watch_stdin_eof(reader, move || f.store(true, Ordering::SeqCst))
            .join()
            .unwrap();
        assert!(fired.load(Ordering::SeqCst));
    }

    struct Failing;
    impl Read for Failing {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("EBADF"))
        }
    }

    #[test]
    fn read_error_counts_as_parent_gone() {
        let fired = Arc::new(AtomicBool::new(false));
        let f = Arc::clone(&fired);
        watch_stdin_eof(Failing, move || f.store(true, Ordering::SeqCst))
            .join()
            .unwrap();
        assert!(fired.load(Ordering::SeqCst));
    }
}
