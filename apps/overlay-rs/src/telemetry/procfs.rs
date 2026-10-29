//! `/proc` helpers for RSS/PSS/comm/starttime. Pure parsers are unit-tested.

use std::fs;
use std::path::PathBuf;

fn proc_path(pid: i32, leaf: &str) -> PathBuf {
    PathBuf::from(format!("/proc/{pid}/{leaf}"))
}

/// RSS from `/proc/<pid>/statm` field 2 (pages) → KiB.
pub fn read_rss_kib(pid: i32) -> Option<u64> {
    let raw = fs::read_to_string(proc_path(pid, "statm")).ok()?;
    parse_statm_rss_kib(&raw, page_size_kib())
}

pub fn parse_statm_rss_kib(statm: &str, page_kib: u64) -> Option<u64> {
    let mut parts = statm.split_whitespace();
    let _size = parts.next()?;
    let rss_pages: u64 = parts.next()?.parse().ok()?;
    Some(rss_pages.saturating_mul(page_kib))
}

/// PSS from `smaps_rollup` when available.
pub fn read_pss_kib(pid: i32) -> Option<u64> {
    let raw = fs::read_to_string(proc_path(pid, "smaps_rollup")).ok()?;
    parse_smaps_rollup_pss_kib(&raw)
}

pub fn parse_smaps_rollup_pss_kib(smaps_rollup: &str) -> Option<u64> {
    for line in smaps_rollup.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Pss:") {
            let kib: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kib);
        }
    }
    None
}

pub fn read_comm(pid: i32) -> Option<String> {
    let raw = fs::read_to_string(proc_path(pid, "comm")).ok()?;
    Some(raw.trim_end_matches('\n').to_string())
}

/// Kernel starttime ticks from `/proc/<pid>/stat` (field 22).
pub fn read_starttime_ticks(pid: i32) -> Option<u64> {
    let raw = fs::read_to_string(proc_path(pid, "stat")).ok()?;
    parse_stat_starttime_ticks(&raw)
}

pub fn parse_stat_starttime_ticks(stat: &str) -> Option<u64> {
    let after_comm = stat.rsplit_once(')')?.1;
    // After ")": state ppid ... starttime is field 22 overall = index 19 after the ')'.
    // Fields after ')': 3=state … so starttime (22) is the 20th token (1-based field 22 - 2).
    let fields: Vec<&str> = after_comm.split_whitespace().collect();
    // field 3 is index 0; field 22 is index 19
    fields.get(19)?.parse().ok()
}

pub fn read_ppid(pid: i32) -> Option<i32> {
    let raw = fs::read_to_string(proc_path(pid, "stat")).ok()?;
    parse_stat_ppid(&raw)
}

pub fn parse_stat_ppid(stat: &str) -> Option<i32> {
    let after_comm = stat.rsplit_once(')')?.1;
    let mut parts = after_comm.split_whitespace();
    let _state = parts.next()?;
    parts.next()?.parse().ok()
}

/// (utime, stime) clock ticks from `/proc/<pid>/stat` fields 14 and 15.
pub fn read_cpu_ticks(pid: i32) -> Option<(u64, u64)> {
    let raw = fs::read_to_string(proc_path(pid, "stat")).ok()?;
    parse_stat_cpu_ticks(&raw)
}

pub fn parse_stat_cpu_ticks(stat: &str) -> Option<(u64, u64)> {
    let after_comm = stat.rsplit_once(')')?.1;
    let fields: Vec<&str> = after_comm.split_whitespace().collect();
    // field 14 → index 11; field 15 → index 12
    let utime: u64 = fields.get(11)?.parse().ok()?;
    let stime: u64 = fields.get(12)?.parse().ok()?;
    Some((utime, stime))
}

pub fn read_meminfo_kib() -> Option<(u64, u64)> {
    let raw = fs::read_to_string("/proc/meminfo").ok()?;
    parse_meminfo_kib(&raw)
}

pub fn parse_meminfo_kib(meminfo: &str) -> Option<(u64, u64)> {
    let mut total = None;
    let mut available = None;
    for line in meminfo.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            total = rest.split_whitespace().next()?.parse().ok();
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            available = rest.split_whitespace().next()?.parse().ok();
        }
    }
    Some((total?, available?))
}

fn page_size_kib() -> u64 {
    (unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as u64) / 1024
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_statm_rss() {
        // size=1000 pages, rss=200 pages; page=4 KiB → 800 KiB
        assert_eq!(parse_statm_rss_kib("1000 200 180 50 0 100 0", 4), Some(800));
        assert!(parse_statm_rss_kib("broken", 4).is_none());
    }

    #[test]
    fn parses_smaps_pss() {
        let sample = "Rss:  1200 kB\nPss:    987 kB\nShared_Clean: 10 kB\n";
        assert_eq!(parse_smaps_rollup_pss_kib(sample), Some(987));
        assert!(parse_smaps_rollup_pss_kib("Rss: 1 kB\n").is_none());
    }

    #[test]
    fn parses_stat_fields_with_spaces_in_comm() {
        // comm may contain spaces/parens; everything after last ')' is fields.
        let stat = "1234 (webkit web process) S 100 100 100 0 -1 4194560 0 0 0 0 10 20 0 0 20 0 1 0 99999 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
        assert_eq!(parse_stat_ppid(stat), Some(100));
        assert_eq!(parse_stat_cpu_ticks(stat), Some((10, 20)));
        assert_eq!(parse_stat_starttime_ticks(stat), Some(99999));
    }

    #[test]
    fn parses_meminfo() {
        let sample = "MemTotal:       16384000 kB\nMemFree:         1000 kB\nMemAvailable:    8192000 kB\n";
        assert_eq!(parse_meminfo_kib(sample), Some((16_384_000, 8_192_000)));
    }
}
