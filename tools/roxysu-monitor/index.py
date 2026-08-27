#!/usr/bin/env python3
"""
Roxysu Monitor — improved edition
----------------------------------
Improvements over the original:
  - Accurate CPU% via /proc/<pid>/stat deltas (not ps rolling average)
  - Peak tracking for CPU, RAM, GPU
  - I/O stats (read/write bytes per second)
  - Background thread for GPU sampling via nvidia-smi dmon (lower latency)
  - CSV log saved next to the script for post-run analysis
  - VSZ (virtual memory) alongside RSS
  - Thread / open-fd counts
  - Graceful fallback when /proc is unavailable (macOS)
"""

import csv
import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path


# ─── Config ────────────────────────────────────────────────────────────────────

INTERVAL   = 0.25   # seconds between samples
HISTORY    = 60     # samples kept for sparklines
WIDTH      = 60     # sparkline character width

LOG_PATH   = Path(f"roxysu_profile_{int(time.time())}.csv")

# ─── Process discovery ─────────────────────────────────────────────────────────

def find_roxysu():
    try:
        result = subprocess.run(
            ["pgrep", "-af", "Roxysu|apps/play|bun"],
            capture_output=True, text=True,
        )
        candidates = []
        for line in result.stdout.splitlines():
            parts = line.split(None, 1)
            if len(parts) != 2:
                continue
            try:
                pid = int(parts[0])
            except ValueError:
                continue
            command = parts[1]
            if "roxysu-monitor" in command:
                continue
            candidates.append((pid, command))

        for pid, command in candidates:
            if "Roxysu" in command:
                return pid
        for pid, command in candidates:
            if "apps/play" in command:
                return pid
        if candidates:
            return candidates[-1][0]
    except Exception:
        pass
    return None


# ─── CPU (accurate delta via /proc) ────────────────────────────────────────────

_prev_proc_ticks: dict[int, tuple[float, float]] = {}   # pid -> (ticks, wall)

def _read_proc_stat(pid):
    """Return (utime + stime) in clock ticks, or None."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            fields = f.read().split()
        return float(fields[13]) + float(fields[14])
    except Exception:
        return None

def _clk_tck():
    try:
        return os.sysconf("SC_CLK_TCK")
    except Exception:
        return 100

def cpu_percent_proc(pid):
    """Accurate instantaneous CPU% for a single pid using /proc/stat deltas."""
    now_ticks = _read_proc_stat(pid)
    now_wall   = time.monotonic()

    if now_ticks is None:
        return None

    prev = _prev_proc_ticks.get(pid)
    _prev_proc_ticks[pid] = (now_ticks, now_wall)

    if prev is None:
        return None

    prev_ticks, prev_wall = prev
    elapsed = now_wall - prev_wall
    if elapsed <= 0:
        return None

    delta_ticks = now_ticks - prev_ticks
    clk = _clk_tck()
    return (delta_ticks / clk) / elapsed * 100.0


# ─── RAM / VSZ ─────────────────────────────────────────────────────────────────

def memory_stats(pid):
    """Returns (rss_mb, vsz_mb) or (None, None)."""
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "rss=,vsz="],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            return None, None
        values = result.stdout.strip().split()
        if len(values) < 2:
            return None, None
        return float(values[0]) / 1024, float(values[1]) / 1024
    except Exception:
        return None, None


# ─── I/O ───────────────────────────────────────────────────────────────────────

_prev_io: dict[int, tuple[float, float, float]] = {}   # pid -> (read, write, wall)

def io_stats_delta(pid):
    """Returns (read_kb_s, write_kb_s) since last call, or (None, None)."""
    try:
        data = {}
        with open(f"/proc/{pid}/io") as f:
            for line in f:
                k, _, v = line.partition(": ")
                data[k.strip()] = int(v.strip())

        rb = data.get("read_bytes", 0)
        wb = data.get("write_bytes", 0)
        now = time.monotonic()

        prev = _prev_io.get(pid)
        _prev_io[pid] = (rb, wb, now)

        if prev is None:
            return None, None

        prev_rb, prev_wb, prev_wall = prev
        elapsed = now - prev_wall
        if elapsed <= 0:
            return None, None

        return (rb - prev_rb) / elapsed / 1024, (wb - prev_wb) / elapsed / 1024
    except Exception:
        return None, None


# ─── Thread / FD counts ────────────────────────────────────────────────────────

def thread_count(pid):
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("Threads:"):
                    return int(line.split()[1])
    except Exception:
        pass
    return None

def fd_count(pid):
    try:
        return len(os.listdir(f"/proc/{pid}/fd"))
    except Exception:
        return None


# ─── GPU (background thread) ───────────────────────────────────────────────────

class GpuSampler(threading.Thread):
    """
    Runs nvidia-smi dmon in a background thread.
    Keeps latest GPU util% for each PID seen.
    """
    def __init__(self):
        super().__init__(daemon=True)
        self._lock   = threading.Lock()
        self._data: dict[int, float] = {}
        self._proc   = None
        self._stop   = threading.Event()
        self.available = bool(shutil.which("nvidia-smi"))

    def run(self):
        if not self.available:
            return
        try:
            self._proc = subprocess.Popen(
                ["nvidia-smi", "dmon", "-s", "um", "-d", "1"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            for line in self._proc.stdout:
                if self._stop.is_set():
                    break
                if line.startswith("#"):
                    continue
                parts = line.split()
                # format: gpu pid type sm mem enc dec
                if len(parts) < 4:
                    continue
                try:
                    pid_val = int(parts[1])
                    sm_val  = float(parts[3])
                    with self._lock:
                        self._data[pid_val] = sm_val
                except (ValueError, IndexError):
                    pass
        except Exception:
            pass

    def get(self, pid):
        with self._lock:
            return self._data.get(pid)

    def stop(self):
        self._stop.set()
        if self._proc:
            try:
                self._proc.terminate()
            except Exception:
                pass

def vram_mb(pid):
    """Query VRAM for a specific PID via query-compute-apps."""
    if not shutil.which("nvidia-smi"):
        return None
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-compute-apps=pid,used_gpu_memory",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=2,
        )
        for line in result.stdout.splitlines():
            parts = [x.strip() for x in line.split(",")]
            if len(parts) != 2:
                continue
            try:
                if int(parts[0]) == pid:
                    return float(parts[1])
            except ValueError:
                pass
    except Exception:
        pass
    return None


# ─── Sparkline ─────────────────────────────────────────────────────────────────

BARS = " ▁▂▃▄▅▆▇█"

def sparkline(values, maximum):
    result = ""
    for v in list(values)[-WIDTH:]:
        if v is None:
            result += " "
        else:
            idx = int(max(0, min(1, v / max(maximum, 1e-9))) * 8)
            result += BARS[idx]
    return result


# ─── Display helpers ───────────────────────────────────────────────────────────

def clear():
    print("\033[2J\033[H", end="")

def fmt(label, value, unit, peak=None):
    if value is None:
        line = f"{label:<10}N/A"
    else:
        line = f"{label:<10}{value:.1f} {unit}"
    if peak is not None:
        line += f"   (peak {peak:.1f} {unit})"
    return line


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) > 1:
        try:
            fixed_pid = int(sys.argv[1])
        except ValueError:
            print(f"Invalid PID: {sys.argv[1]}")
            sys.exit(1)
    else:
        fixed_pid = None

    cpu_hist  = deque(maxlen=WIDTH)
    ram_hist  = deque(maxlen=WIDTH)
    gpu_hist  = deque(maxlen=WIDTH)
    vram_hist = deque(maxlen=WIDTH)

    peak_cpu  = 0.0
    peak_ram  = 0.0
    peak_gpu  = 0.0
    peak_vram = 0.0

    gpu_sampler = GpuSampler()
    gpu_sampler.start()

    # CSV log
    log_file   = LOG_PATH.open("w", newline="")
    log_writer = csv.writer(log_file)
    log_writer.writerow([
        "timestamp", "pid",
        "cpu_pct", "ram_mb", "vsz_mb",
        "gpu_pct", "vram_mb",
        "read_kb_s", "write_kb_s",
        "threads", "fds",
    ])

    print("\033[?25l", end="")  # hide cursor

    try:
        while True:
            pid = fixed_pid if fixed_pid is not None else find_roxysu()

            clear()
            print("ROXYSU MONITOR (gpuix)")
            print("─" * 70)

            if pid is None:
                print("\nRoxysu not found. Waiting…")
                time.sleep(1)
                continue

            # Collect
            cpu          = cpu_percent_proc(pid)
            rss, vsz     = memory_stats(pid)
            gpu          = gpu_sampler.get(pid)
            vram         = vram_mb(pid)
            read_s, wrt_s = io_stats_delta(pid)
            threads      = thread_count(pid)
            fds          = fd_count(pid)

            # Process disappeared
            if rss is None:
                msg = f"\nProcess {pid} gone." if fixed_pid else "\nRoxysu not found."
                print(msg)
                time.sleep(1)
                continue

            # Update histories
            cpu_hist.append(cpu)
            ram_hist.append(rss)
            gpu_hist.append(gpu)
            vram_hist.append(vram)

            # Update peaks
            if cpu  is not None: peak_cpu  = max(peak_cpu,  cpu)
            if rss  is not None: peak_ram  = max(peak_ram,  rss)
            if gpu  is not None: peak_gpu  = max(peak_gpu,  gpu)
            if vram is not None: peak_vram = max(peak_vram, vram)

            # Log to CSV
            log_writer.writerow([
                f"{time.time():.3f}", pid,
                f"{cpu:.2f}"  if cpu  is not None else "",
                f"{rss:.1f}"  if rss  is not None else "",
                f"{vsz:.1f}"  if vsz  is not None else "",
                f"{gpu:.1f}"  if gpu  is not None else "",
                f"{vram:.1f}" if vram is not None else "",
                f"{read_s:.1f}" if read_s is not None else "",
                f"{wrt_s:.1f}"  if wrt_s  is not None else "",
                threads if threads is not None else "",
                fds     if fds     is not None else "",
            ])
            log_file.flush()

            # ── Display ────────────────────────────────────────────────────────
            print(f"PID       {pid}")
            print(f"Log       {LOG_PATH.resolve()}")
            print(f"Sample    {INTERVAL * 1000:.0f} ms")
            print()

            print(fmt("CPU",  cpu,  "%",  peak_cpu  if peak_cpu  > 0 else None))
            print(fmt("RAM",  rss,  "MB", peak_ram  if peak_ram  > 0 else None))
            print(fmt("VSZ",  vsz,  "MB"))
            print(fmt("GPU",  gpu,  "%",  peak_gpu  if peak_gpu  > 0 else None))
            print(fmt("VRAM", vram, "MB", peak_vram if peak_vram > 0 else None))

            if read_s is not None or wrt_s is not None:
                r = f"{read_s:.1f} KB/s" if read_s is not None else "N/A"
                w = f"{wrt_s:.1f} KB/s"  if wrt_s  is not None else "N/A"
                print(f"I/O       ↑{r}  ↓{w}")

            if threads is not None:
                print(f"Threads   {threads}   FDs {fds}")

            print()
            print("CPU  " + sparkline(cpu_hist, 100))
            print("GPU  " + sparkline(gpu_hist, 100))

            ram_max = max(1024, max((x for x in ram_hist if x is not None), default=1024))
            print("RAM  " + sparkline(ram_hist, ram_max))

            if any(v is not None for v in vram_hist):
                vram_max = max(1024, max((x for x in vram_hist if x is not None), default=1024))
                print("VRAM " + sparkline(vram_hist, vram_max))

            print()
            print(f"Ctrl+C to exit  |  log → {LOG_PATH.name}")

            time.sleep(INTERVAL)

    except KeyboardInterrupt:
        pass

    finally:
        gpu_sampler.stop()
        log_file.close()
        print("\033[?25h", end="")  # restore cursor
        print(f"\nLog saved to: {LOG_PATH.resolve()}")


if __name__ == "__main__":
    main()