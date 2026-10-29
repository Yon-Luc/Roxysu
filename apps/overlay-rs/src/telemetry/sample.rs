//! One observation snapshot (host + tree + system + optional cgroup).

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::cgroup;
use super::procfs::read_meminfo_kib;
use super::tree::{collect_tree, ProcRole, ProcSample};

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub unix_ms: u64,
    pub phase: String,
    pub processes: Vec<ProcSample>,
    pub tree_rss_kib: u64,
    pub tree_pss_kib: Option<u64>,
    pub cgroup_current_bytes: Option<u64>,
    pub cgroup_peak_bytes: Option<u64>,
    pub mem_total_kib: Option<u64>,
    pub mem_available_kib: Option<u64>,
}

impl Snapshot {
    pub fn capture(root_pid: i32, phase: &str) -> Self {
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let processes = collect_tree(root_pid);
        let tree_rss_kib = processes.iter().map(|p| p.rss_kib).sum();
        let tree_pss_kib = {
            let mut sum = 0u64;
            let mut any = false;
            for p in &processes {
                if let Some(pss) = p.pss_kib {
                    sum = sum.saturating_add(pss);
                    any = true;
                }
            }
            any.then_some(sum)
        };
        let (cgroup_current_bytes, cgroup_peak_bytes) = if let Some(dir) = cgroup::self_cgroup_dir()
        {
            (
                cgroup::read_memory_current(&dir),
                cgroup::read_memory_peak(&dir),
            )
        } else {
            (None, None)
        };
        let (mem_total_kib, mem_available_kib) = match read_meminfo_kib() {
            Some((t, a)) => (Some(t), Some(a)),
            None => (None, None),
        };
        Self {
            unix_ms,
            phase: phase.to_string(),
            processes,
            tree_rss_kib,
            tree_pss_kib,
            cgroup_current_bytes,
            cgroup_peak_bytes,
            mem_total_kib,
            mem_available_kib,
        }
    }

    pub fn host(&self) -> Option<&ProcSample> {
        self.processes.iter().find(|p| p.role == ProcRole::Host)
    }

    pub fn csv_header() -> &'static str {
        "timestamp_ms,phase,pid,start_time,process_name,role,rss_kib,pss_kib,cpu_ticks,\
tree_rss_kib,tree_pss_kib,cgroup_current_bytes,cgroup_peak_bytes,mem_total_kib,mem_available_kib"
    }

    pub fn write_csv_rows(&self, mut w: impl std::io::Write) -> std::io::Result<()> {
        let tree_pss = self
            .tree_pss_kib
            .map(|v| v.to_string())
            .unwrap_or_default();
        let cg_cur = self
            .cgroup_current_bytes
            .map(|v| v.to_string())
            .unwrap_or_default();
        let cg_peak = self
            .cgroup_peak_bytes
            .map(|v| v.to_string())
            .unwrap_or_default();
        let mem_t = self.mem_total_kib.map(|v| v.to_string()).unwrap_or_default();
        let mem_a = self
            .mem_available_kib
            .map(|v| v.to_string())
            .unwrap_or_default();
        for p in &self.processes {
            let pss = p.pss_kib.map(|v| v.to_string()).unwrap_or_default();
            let cpu = p.cpu_ticks.map(|v| v.to_string()).unwrap_or_default();
            writeln!(
                w,
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                self.unix_ms,
                csv_escape(&self.phase),
                p.pid,
                p.start_time,
                csv_escape(&p.process_name),
                p.role.as_str(),
                p.rss_kib,
                pss,
                cpu,
                self.tree_rss_kib,
                tree_pss,
                cg_cur,
                cg_peak,
                mem_t,
                mem_a,
            )?;
        }
        Ok(())
    }

    pub fn log_summary(&self) {
        let host_rss = self.host().map(|h| h.rss_kib).unwrap_or(0);
        let host_pss = self.host().and_then(|h| h.pss_kib);
        tracing::info!(
            phase = %self.phase,
            host_rss_kib = host_rss,
            host_pss_kib = host_pss,
            tree_rss_kib = self.tree_rss_kib,
            tree_pss_kib = self.tree_pss_kib,
            procs = self.processes.len(),
            cgroup_current_bytes = self.cgroup_current_bytes,
            mem_available_kib = self.mem_available_kib,
            "telemetry sample"
        );
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn ensure_csv_header(path: &Path) -> std::io::Result<()> {
    use std::fs::OpenOptions;
    use std::io::Write;
    if path.exists() && path.metadata()?.len() > 0 {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{}", Snapshot::csv_header())?;
    Ok(())
}

pub fn append_csv(path: &Path, snap: &Snapshot) -> std::io::Result<()> {
    use std::fs::OpenOptions;
    ensure_csv_header(path)?;
    let f = OpenOptions::new().create(true).append(true).open(path)?;
    snap.write_csv_rows(f)
}
