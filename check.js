#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const file = process.argv[2];
const interval = Math.max(250, Number(process.argv[3]) || 1000);

if (!file) {
  console.error("Usage: node roxysu-telemetry.js telemetry.csv [refresh_ms]");
  process.exit(1);
}

const mib = (n) => (Number(n) / 1024).toFixed(1);
const gib = (n) => (Number(n) / 1024 ** 3).toFixed(2);

function render() {
  try {
    const lines = fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/);

    if (lines.length < 2) return;

    const headers = lines[0].split(",");
    const rows = lines
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const values = line.split(",");
        return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
      });

    const latestTimestamp = rows.reduce(
      (max, r) => Math.max(max, Number(r.timestamp_ms) || 0),
      0,
    );

    const latest = rows.filter(
      (r) => Number(r.timestamp_ms) === latestTimestamp,
    );

    if (!latest.length) return;

    const s = latest[0];
    const date = new Date(latestTimestamp).toLocaleTimeString();

    const pad = (v, n) => String(v).slice(0, n).padEnd(n);
    const table = [
      `${pad("PID", 8)} ${pad("PROCESS", 20)} ${pad("ROLE", 15)} ${pad("RSS MiB", 10)} ${pad("PSS MiB", 10)} CPU ticks`,
    ];

    for (const r of latest) {
      table.push(
        `${pad(r.pid, 8)} ${pad(r.process_name, 20)} ` +
          `${pad(r.role, 15)} ${pad(mib(r.rss_kib), 10)} ` +
          `${pad(mib(r.pss_kib), 10)} ${r.cpu_ticks}`,
      );
    }

    console.clear();
    console.log("=== Roxysu Overlay Telemetry ===");
    console.log(`File: ${path.resolve(file)}`);
    console.log(`Sample: ${date} | Phase: ${s.phase}`);
    console.log("");
    console.log(`Tree RSS:       ${mib(s.tree_rss_kib)} MiB`);
    console.log(`Tree PSS:       ${mib(s.tree_pss_kib)} MiB`);
    console.log(`Cgroup current: ${gib(s.cgroup_current_bytes)} GiB`);
    console.log(`Cgroup peak:    ${gib(s.cgroup_peak_bytes)} GiB`);
    console.log(
      `System RAM:     ${(Number(s.mem_total_kib) / 1048576).toFixed(2)} GiB`,
    );
    console.log(
      `RAM available:  ${(Number(s.mem_available_kib) / 1048576).toFixed(2)} GiB`,
    );
    console.log("");
    console.log(table.join("\n"));
    console.log("\nRefreshes automatically. Press Ctrl+C to quit.");
  } catch (err) {
    console.error(`Cannot read CSV: ${err.message}`);
  }
}

render();
setInterval(render, interval);
