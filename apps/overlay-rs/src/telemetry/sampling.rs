//! Background sampler — never runs on the GTK main loop.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tracing::{info, warn};

use super::sample::{append_csv, Snapshot};

pub struct SamplerHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl SamplerHandle {
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
        info!("telemetry sampler stopped");
    }
}

impl Drop for SamplerHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// Start periodic sampling. `interval_sec` must be > 0.
pub fn start(
    interval_sec: u64,
    phase: String,
    csv_path: Option<PathBuf>,
) -> SamplerHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let root = std::process::id() as i32;

    let join = thread::Builder::new()
        .name("overlay-telemetry".into())
        .spawn(move || {
            info!(
                interval_sec,
                phase = %phase,
                csv = ?csv_path,
                "telemetry sampler started"
            );
            // First sample shortly after start (startup phase visibility).
            loop {
                if stop_thread.load(Ordering::SeqCst) {
                    break;
                }
                let snap = Snapshot::capture(root, &phase);
                snap.log_summary();
                if let Some(ref path) = csv_path {
                    if let Err(err) = append_csv(path, &snap) {
                        warn!(error = %err, path = %path.display(), "telemetry csv write failed");
                    }
                }
                // Sleep in slices so shutdown is responsive.
                let slices = (interval_sec.max(1)) * 10;
                for _ in 0..slices {
                    if stop_thread.load(Ordering::SeqCst) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            }
        })
        .expect("spawn telemetry thread");

    SamplerHandle {
        stop,
        join: Some(join),
    }
}
