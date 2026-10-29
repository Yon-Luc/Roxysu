//! Background watchdog loop. Exits the process with a non-zero code on breach.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tracing::{error, info, warn};

use super::policy::{evaluate, BreachWindow, Thresholds};
use super::scan::measure;

/// Non-zero so `Restart=on-failure` / desktop respawn policies work.
/// C used `exit(0)`, which defeated on-failure restarts.
pub const WATCHDOG_EXIT_CODE: i32 = 75;

pub struct WatchdogHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl WatchdogHandle {
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
        info!("watchdog stopped");
    }
}

impl Drop for WatchdogHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

pub fn start(interval_sec: u64, thresholds: Thresholds) -> WatchdogHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let root = std::process::id() as i32;
    let started = Instant::now();

    let join = thread::Builder::new()
        .name("overlay-watchdog".into())
        .spawn(move || {
            info!(
                interval_sec,
                max_age_sec = ?thresholds.max_age_sec,
                max_fds = thresholds.max_fds,
                max_rss_mb = thresholds.max_rss_mb,
                max_cgroup_mb = ?thresholds.max_cgroup_mb,
                breach_samples = thresholds.breach_samples,
                "watchdog started"
            );
            let mut window = BreachWindow::new();
            loop {
                if stop_thread.load(Ordering::SeqCst) {
                    break;
                }
                let m = measure(root, started);
                let hit = evaluate(&m, &thresholds);
                if let Some(reason) = hit {
                    warn!(
                        reason = reason.as_str(),
                        age_sec = m.age_sec,
                        max_descendant_fds = m.max_descendant_fds,
                        descendant_rss_mb = m.descendant_rss_mb,
                        tree_rss_mb = m.tree_rss_mb,
                        cgroup_mb = m.cgroup_mb,
                        "watchdog threshold exceeded (sample)"
                    );
                }
                if let Some(reason) =
                    window.observe(hit, thresholds.breach_samples)
                {
                    error!(
                        reason = reason.as_str(),
                        age_sec = m.age_sec,
                        max_descendant_fds = m.max_descendant_fds,
                        descendant_rss_mb = m.descendant_rss_mb,
                        tree_rss_mb = m.tree_rss_mb,
                        cgroup_mb = m.cgroup_mb,
                        breach_samples = thresholds.breach_samples,
                        exit_code = WATCHDOG_EXIT_CODE,
                        "watchdog: exiting for clean respawn"
                    );
                    eprintln!(
                        "roxysu-overlay-rs: watchdog: {} exceeded \
                         (age={}s descendant_rss={}MB tree_rss={}MB max_fds={} cgroup_mb={:?}) \
                         — exiting with code {WATCHDOG_EXIT_CODE} for respawn",
                        reason.as_str(),
                        m.age_sec,
                        m.descendant_rss_mb,
                        m.tree_rss_mb,
                        m.max_descendant_fds,
                        m.cgroup_mb
                    );
                    std::process::exit(WATCHDOG_EXIT_CODE);
                }

                let slices = interval_sec.max(1) * 10;
                for _ in 0..slices {
                    if stop_thread.load(Ordering::SeqCst) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            }
        })
        .expect("spawn watchdog thread");

    WatchdogHandle {
        stop,
        join: Some(join),
    }
}
