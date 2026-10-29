//! Collect a [`Measurement`] from `/proc` (off the GTK thread).

use std::time::Instant;

use crate::telemetry::cgroup;
use crate::telemetry::procfs::read_fd_count;
use crate::telemetry::tree::{collect_tree, ProcRole};

use super::policy::Measurement;

pub fn measure(root_pid: i32, started: Instant) -> Measurement {
    let age_sec = started.elapsed().as_secs();
    let procs = collect_tree(root_pid);

    let mut descendant_rss_kib = 0u64;
    let mut tree_rss_kib = 0u64;
    let mut max_descendant_fds = 0u64;

    for p in &procs {
        tree_rss_kib = tree_rss_kib.saturating_add(p.rss_kib);
        if p.role == ProcRole::Host {
            continue;
        }
        descendant_rss_kib = descendant_rss_kib.saturating_add(p.rss_kib);
        if let Some(fds) = read_fd_count(p.pid) {
            max_descendant_fds = max_descendant_fds.max(fds);
        }
    }

    let cgroup_mb = cgroup::self_cgroup_dir()
        .and_then(|d| cgroup::read_memory_current(&d))
        .map(|bytes| bytes / (1024 * 1024));

    Measurement {
        age_sec,
        max_descendant_fds,
        descendant_rss_mb: descendant_rss_kib / 1024,
        tree_rss_mb: tree_rss_kib / 1024,
        cgroup_mb,
    }
}
