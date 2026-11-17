//! Lightweight process resource sampling for the play HUD.
//!
//! CPU/RSS from `/proc` every sample. `nvidia-smi` is expensive (fork/exec) — only
//! every few seconds so it cannot hitch the playfield.

use std::fs;
use std::process::Command;
use std::time::{Duration, Instant};

const GPU_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Default)]
pub struct ResourceSample {
    pub rss_mb: f64,
    pub cpu_pct: f64,
    pub gpu_mb: Option<f64>,
    pub gpu_label: &'static str,
}

pub struct ResourceMonitor {
    prev_cpu: Option<(u64, Instant)>,
    last: ResourceSample,
    last_gpu_at: Option<Instant>,
    gpu_mb: Option<f64>,
    gpu_label: &'static str,
}

impl ResourceMonitor {
    pub fn new() -> Self {
        Self {
            prev_cpu: None,
            last: ResourceSample::default(),
            last_gpu_at: None,
            gpu_mb: None,
            gpu_label: "gpu …",
        }
    }

    pub fn sample(&mut self) -> &ResourceSample {
        let rss_mb = read_rss_kb().map(|kb| kb as f64 / 1024.0).unwrap_or(0.0);
        let cpu_pct = self.sample_cpu();
        self.refresh_gpu_if_due();
        self.last = ResourceSample {
            rss_mb,
            cpu_pct,
            gpu_mb: self.gpu_mb,
            gpu_label: self.gpu_label,
        };
        &self.last
    }

    fn refresh_gpu_if_due(&mut self) {
        let due = self
            .last_gpu_at
            .is_none_or(|t| t.elapsed() >= GPU_INTERVAL);
        if !due {
            return;
        }
        let (mb, label) = sample_gpu_mb();
        self.gpu_mb = mb;
        self.gpu_label = label;
        self.last_gpu_at = Some(Instant::now());
    }

    fn sample_cpu(&mut self) -> f64 {
        let Some(ticks) = read_cpu_ticks() else {
            return 0.0;
        };
        let now = Instant::now();
        let pct = if let Some((prev_ticks, prev_at)) = self.prev_cpu {
            let wall = now.saturating_duration_since(prev_at).as_secs_f64();
            let delta = ticks.saturating_sub(prev_ticks) as f64;
            let hz = ticks_per_second();
            if wall > 0.0 && hz > 0.0 {
                (100.0 * delta / (hz * wall)).clamp(0.0, 400.0)
            } else {
                0.0
            }
        } else {
            0.0
        };
        self.prev_cpu = Some((ticks, now));
        pct
    }
}

fn ticks_per_second() -> f64 {
    let t = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if t > 0 {
        t as f64
    } else {
        100.0
    }
}

fn read_rss_kb() -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kb);
        }
    }
    None
}

fn read_cpu_ticks() -> Option<u64> {
    let stat = fs::read_to_string("/proc/self/stat").ok()?;
    let after_comm = stat.rsplit_once(')')?.1;
    let mut parts = after_comm.split_whitespace();
    let utime: u64 = parts.nth(11)?.parse().ok()?;
    let stime: u64 = parts.next()?.parse().ok()?;
    Some(utime.saturating_add(stime))
}

fn sample_gpu_mb() -> (Option<f64>, &'static str) {
    let pid = std::process::id().to_string();
    let Ok(output) = Command::new("nvidia-smi")
        .args([
            "--query-compute-apps=pid,used_gpu_memory",
            "--format=csv,noheader,nounits",
        ])
        .output()
    else {
        return (None, "gpu n/a");
    };
    if !output.status.success() {
        return (None, "gpu n/a");
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let mut cols = line.split(',').map(str::trim);
        let Some(p) = cols.next() else {
            continue;
        };
        if p != pid {
            continue;
        }
        if let Some(mb) = cols.next().and_then(|s| s.parse::<f64>().ok()) {
            return (Some(mb), "nvidia");
        }
    }
    (None, "nvidia (no app mem)")
}
