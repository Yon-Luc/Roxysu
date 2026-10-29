//! Process-tree discovery under the overlay host (includes the host).

use std::collections::{HashMap, HashSet};
use std::fs;

use super::procfs::{read_comm, read_cpu_ticks, read_ppid, read_pss_kib, read_rss_kib, read_starttime_ticks};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcRole {
    Host,
    WebKitNetwork,
    WebKitWeb,
    WebKitOther,
    Child,
}

impl ProcRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::WebKitNetwork => "webkit-network",
            Self::WebKitWeb => "webkit-web",
            Self::WebKitOther => "webkit-other",
            Self::Child => "child",
        }
    }

    pub fn from_comm(comm: &str, is_root: bool) -> Self {
        if is_root {
            return Self::Host;
        }
        let lower = comm.to_lowercase();
        if lower.contains("webkitnetwork") || lower.contains("networkprocess") {
            Self::WebKitNetwork
        } else if lower.contains("webkitweb") || lower.contains("webprocess") {
            Self::WebKitWeb
        } else if lower.contains("webkit") {
            Self::WebKitOther
        } else {
            Self::Child
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProcSample {
    pub pid: i32,
    pub start_time: u64,
    pub process_name: String,
    pub role: ProcRole,
    pub rss_kib: u64,
    pub pss_kib: Option<u64>,
    pub cpu_ticks: Option<u64>,
}

#[derive(Debug, Clone)]
struct ProcRow {
    pid: i32,
    ppid: i32,
}

/// Snapshot every process in `/proc` that is the host or a descendant.
pub fn collect_tree(root_pid: i32) -> Vec<ProcSample> {
    let mut rows: Vec<ProcRow> = Vec::new();
    let Ok(dir) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    for entry in dir.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Ok(pid) = name.parse::<i32>() else {
            continue;
        };
        if pid <= 0 {
            continue;
        }
        let Some(ppid) = read_ppid(pid) else {
            continue;
        };
        rows.push(ProcRow { pid, ppid });
    }

    let by_pid: HashMap<i32, i32> = rows.iter().map(|r| (r.pid, r.ppid)).collect();
    let mut marked: HashSet<i32> = HashSet::new();
    marked.insert(root_pid);
    let mut progressed = true;
    while progressed {
        progressed = false;
        for (pid, ppid) in &by_pid {
            if marked.contains(pid) {
                continue;
            }
            if marked.contains(ppid) {
                marked.insert(*pid);
                progressed = true;
            }
        }
    }

    let mut out = Vec::new();
    for pid in marked {
        let name = read_comm(pid).unwrap_or_else(|| "?".into());
        let role = ProcRole::from_comm(&name, pid == root_pid);
        let rss = read_rss_kib(pid).unwrap_or(0);
        let pss = read_pss_kib(pid);
        let start = read_starttime_ticks(pid).unwrap_or(0);
        let cpu = read_cpu_ticks(pid).map(|(u, s)| u.saturating_add(s));
        out.push(ProcSample {
            pid,
            start_time: start,
            process_name: name,
            role,
            rss_kib: rss,
            pss_kib: pss,
            cpu_ticks: cpu,
        });
    }
    out.sort_by_key(|p| p.pid);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_from_comm() {
        assert_eq!(ProcRole::from_comm("roxysu-overlay-rs", true), ProcRole::Host);
        assert_eq!(
            ProcRole::from_comm("WebKitNetworkProcess", false),
            ProcRole::WebKitNetwork
        );
        assert_eq!(
            ProcRole::from_comm("WebKitWebProcess", false),
            ProcRole::WebKitWeb
        );
        assert_eq!(ProcRole::from_comm("bwrap", false), ProcRole::Child);
    }
}
