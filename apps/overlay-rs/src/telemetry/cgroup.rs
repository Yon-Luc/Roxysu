//! Optional cgroup v2 memory stats (user slice / scope).

use std::fs;
use std::path::{Path, PathBuf};

/// Resolve this process's cgroup directory (v2 unified hierarchy).
pub fn self_cgroup_dir() -> Option<PathBuf> {
    let raw = fs::read_to_string("/proc/self/cgroup").ok()?;
    parse_cgroup_v2_path(&raw).map(|rel| PathBuf::from("/sys/fs/cgroup").join(rel.trim_start_matches('/')))
}

pub fn parse_cgroup_v2_path(cgroup_file: &str) -> Option<String> {
    // v2: "0::/user.slice/..."
    for line in cgroup_file.lines() {
        if let Some(rest) = line.strip_prefix("0::") {
            return Some(rest.to_string());
        }
    }
    None
}

pub fn read_memory_current(dir: &Path) -> Option<u64> {
    fs::read_to_string(dir.join("memory.current"))
        .ok()?
        .trim()
        .parse()
        .ok()
}

pub fn read_memory_peak(dir: &Path) -> Option<u64> {
    // memory.peak is optional on older kernels.
    fs::read_to_string(dir.join("memory.peak"))
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_unified_cgroup_path() {
        let sample = "0::/user.slice/user-1000.slice/session-3.scope\n";
        assert_eq!(
            parse_cgroup_v2_path(sample).as_deref(),
            Some("/user.slice/user-1000.slice/session-3.scope")
        );
        assert!(parse_cgroup_v2_path("1:name=systemd:/\n").is_none());
    }
}
