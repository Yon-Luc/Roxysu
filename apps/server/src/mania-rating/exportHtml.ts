import type { CompareRow } from "./compare";

/** Slim row embedded in the static HTML (no attributes). */
export type AnalyseExportRow = {
  onlineId: number | null;
  setOnlineId: number | null;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  keyCount: number | null;
  importedStarRating: number;
  baseline: {
    starRating: number | null;
    ppSs: number | null;
    error: string | null;
  };
  experiment: {
    starRating: number | null;
    ppSs: number | null;
    error: string | null;
  };
  delta: {
    starRating: number | null;
    ppSs: number | null;
  };
  cached: {
    baseline: boolean;
    experiment: boolean;
  };
};

export type AnalyseExportMeta = {
  query: string;
  baselineVersionId: string;
  experimentVersionId: string;
  baselineLabel: string;
  experimentLabel: string;
  usesImport: boolean;
  generatedAt: string;
};

export type AnalyseExportPayload = {
  meta: AnalyseExportMeta;
  rows: AnalyseExportRow[];
};

export function slimCompareRow(row: CompareRow): AnalyseExportRow {
  return {
    onlineId: row.onlineId,
    setOnlineId: row.setOnlineId,
    title: row.title,
    artist: row.artist,
    difficultyName: row.difficultyName,
    keyCount: row.keyCount,
    importedStarRating: row.importedStarRating,
    baseline: {
      starRating: row.baseline.starRating,
      ppSs: row.baseline.ppSs,
      error: row.baseline.error,
    },
    experiment: {
      starRating: row.experiment.starRating,
      ppSs: row.experiment.ppSs,
      error: row.experiment.error,
    },
    delta: {
      starRating: row.delta.starRating,
      ppSs: row.delta.ppSs,
    },
    cached: {
      baseline: row.cached.baseline,
      experiment: row.cached.experiment,
    },
  };
}

/** JSON safe to embed in a `<script type="application/json">` block. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function osuWebManiaUrl(
  onlineId: number | null,
  setOnlineId: number | null,
): string | null {
  if (onlineId == null || onlineId <= 0) return null;
  if (setOnlineId != null && setOnlineId > 0) {
    return `https://osu.ppy.sh/beatmapsets/${setOnlineId}#mania/${onlineId}`;
  }
  return `https://osu.ppy.sh/b/${onlineId}`;
}

export function osuCoverListUrl(setOnlineId: number | null): string | null {
  if (setOnlineId == null || setOnlineId <= 0) return null;
  return `https://assets.ppy.sh/beatmaps/${setOnlineId}/covers/list@2x.jpg`;
}

export function buildRatingLabAnalyseHtml(
  meta: AnalyseExportMeta,
  rows: AnalyseExportRow[],
): string {
  const payload: AnalyseExportPayload = { meta, rows };
  const dataJson = embedJson(payload);
  const title = escapeHtml(
    `Rating Lab · ${meta.baselineLabel} vs ${meta.experimentLabel}`,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
:root {
  --canvas: #121212;
  --surface: #181818;
  --elevated: #242424;
  --highlight: #2a2a2a;
  --ink: #ffffff;
  --subtle: #b3b3b3;
  --muted: #a7a7a7;
  --faint: #6a6a6a;
  --accent: #7c8fe0;
  --accent-dim: #6b7bcf;
  --line: #333;
  --up: #6bcf8e;
  --down: #e879a8;
  --font: "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font);
  background: var(--canvas);
  color: var(--ink);
  line-height: 1.45;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
header h1 { margin: 0 0 0.35rem; font-size: 1.5rem; font-weight: 700; }
header .meta { color: var(--muted); font-size: 0.875rem; }
header .query {
  margin-top: 0.75rem;
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--subtle);
  word-break: break-all;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1.1rem 1.25rem;
  margin-top: 1.25rem;
}
.panel h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  font-weight: 700;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
}
.stat {
  background: var(--elevated);
  border-radius: 10px;
  padding: 0.75rem 0.9rem;
}
.stat .label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--faint);
}
.stat .value {
  margin-top: 0.25rem;
  font-size: 1.15rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: end;
  margin-bottom: 1rem;
}
.controls label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--faint);
}
.controls input, .controls select {
  min-width: 12rem;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--elevated);
  color: var(--ink);
  font-size: 0.875rem;
}
.hist {
  display: flex;
  align-items: flex-end;
  gap: 0.4rem;
  height: 160px;
  padding-top: 0.5rem;
}
.hist-bar-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
  gap: 0.35rem;
  min-width: 0;
}
.hist-bar {
  width: 100%;
  max-width: 48px;
  background: var(--accent);
  border-radius: 4px 4px 0 0;
  min-height: 2px;
}
.hist-label {
  font-size: 0.65rem;
  color: var(--faint);
  text-align: center;
  line-height: 1.2;
}
.hist-count {
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  color: var(--subtle);
}
.movers { display: grid; gap: 0.35rem; }
.mover {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  background: var(--elevated);
  font-size: 0.85rem;
}
.mover .delta { font-variant-numeric: tabular-nums; font-weight: 600; }
.table-wrap { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
th, td {
  padding: 0.55rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--faint);
  white-space: nowrap;
  user-select: none;
}
th.sortable { cursor: pointer; }
th.sortable:hover { color: var(--ink); }
th .arrow { margin-left: 0.2rem; color: var(--accent); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.map-cell { display: flex; align-items: center; gap: 0.65rem; min-width: 220px; }
.cover {
  width: 48px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  background: linear-gradient(135deg, #2a2a2a, #3a3a4a);
  flex-shrink: 0;
}
.map-title { font-weight: 600; }
.map-sub { font-size: 0.75rem; color: var(--muted); }
.err { font-size: 0.7rem; color: var(--down); }
.delta-pos { color: var(--up); }
.delta-neg { color: var(--down); }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.3rem 0.55rem;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--elevated);
  color: var(--ink);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}
.btn:hover { background: var(--highlight); text-decoration: none; }
.btn[aria-disabled="true"] {
  opacity: 0.4;
  pointer-events: none;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.9rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.pager button {
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--elevated);
  color: var(--ink);
  cursor: pointer;
  font-size: 0.8rem;
}
.pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.empty { color: var(--faint); padding: 1.5rem 0; text-align: center; }
.credits {
  margin-top: 1.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.6;
}
.credits a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Rating Lab analysis</h1>
    <p class="meta" id="header-meta"></p>
    <p class="query" id="header-query"></p>
  </header>

  <section class="panel">
    <h2>Summary</h2>
    <div class="stats" id="stats"></div>
  </section>

  <section class="panel">
    <h2>SR delta distribution</h2>
    <div class="hist" id="histogram"></div>
  </section>

  <section class="panel">
    <h2>Results</h2>
    <div class="controls">
      <label>
        Name filter
        <input type="search" id="name-filter" placeholder="Title, artist, difficulty…" autocomplete="off"/>
      </label>
      <label>
        Keymode
        <select id="keymode-filter">
          <option value="">All</option>
        </select>
      </label>
    </div>
    <div class="table-wrap">
      <table>
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
    <div class="empty" id="empty" hidden>No matches for this filter.</div>
    <div class="pager" id="pager">
      <button type="button" id="prev-page">Prev</button>
      <span id="page-info"></span>
      <button type="button" id="next-page">Next</button>
    </div>
  </section>

  <section class="panel">
    <h2>Largest SR movers</h2>
    <div class="movers" id="star-movers"></div>
  </section>

  <section class="panel">
    <h2>Largest PP movers</h2>
    <div class="movers" id="pp-movers"></div>
  </section>

  <footer class="credits">
    Roxysu made by
    <a href="https://osu.ppy.sh/users/36810767" target="_blank" rel="noopener">Noy</a>
    · rework at
    <a href="https://github.com/EnissayDev/osu/tree/enissay-mania-sr-rework" target="_blank" rel="noopener">https://github.com/EnissayDev/osu/tree/enissay-mania-sr-rework</a>
  </footer>
</div>
<script type="application/json" id="rating-lab-data">${dataJson}</script>
<script>
(function () {
  var PAGE_SIZE = 48;
  var dataEl = document.getElementById("rating-lab-data");
  var payload = JSON.parse(dataEl.textContent);
  var meta = payload.meta;
  var allRows = payload.rows;

  var state = {
    name: "",
    keymode: "",
    sort: "map",
    order: "asc",
    page: 1,
  };

  var BIN_DEFS = [
    { key: "lt-1", label: "< −1★", test: function (d) { return d < -1; } },
    { key: "m1", label: "−1 to −0.5", test: function (d) { return d < -0.5; } },
    { key: "m05", label: "−0.5 to −0.1", test: function (d) { return d < -0.1; } },
    { key: "flat", label: "±0.1", test: function (d) { return d <= 0.1; } },
    { key: "p05", label: "+0.1 to +0.5", test: function (d) { return d <= 0.5; } },
    { key: "p1", label: "+0.5 to +1", test: function (d) { return d <= 1; } },
    { key: "gt1", label: "> +1★", test: function (d) { return true; } },
  ];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(v, digits) {
    if (v == null || Number.isNaN(v)) return "—";
    return Number(v).toFixed(digits);
  }

  function fmtDelta(v, digits) {
    if (v == null || Number.isNaN(v)) return "—";
    var n = Number(v);
    var sign = n > 0 ? "+" : "";
    return sign + n.toFixed(digits);
  }

  function deltaClass(v) {
    if (v == null || v === 0) return "";
    return v > 0 ? "delta-pos" : "delta-neg";
  }

  function mean(values) {
    if (!values.length) return null;
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  }

  function buildHistogram(deltas) {
    var bins = BIN_DEFS.map(function (b) {
      return { key: b.key, label: b.label, count: 0 };
    });
    for (var i = 0; i < deltas.length; i++) {
      var d = deltas[i];
      for (var j = 0; j < BIN_DEFS.length; j++) {
        if (BIN_DEFS[j].test(d)) {
          bins[j].count++;
          break;
        }
      }
    }
    return bins;
  }

  function webLink(row) {
    if (row.onlineId == null) return null;
    if (row.setOnlineId != null) {
      return "https://osu.ppy.sh/beatmapsets/" + row.setOnlineId + "#mania/" + row.onlineId;
    }
    return "https://osu.ppy.sh/b/" + row.onlineId;
  }

  function coverUrl(row) {
    if (row.setOnlineId == null) return null;
    return "https://assets.ppy.sh/beatmaps/" + row.setOnlineId + "/covers/list@2x.jpg";
  }

  function mapLabel(row) {
    var title = row.title || "Untitled";
    var artist = row.artist || "";
    var diff = row.difficultyName ? "[" + row.difficultyName + "]" : "";
    var keys = row.keyCount != null ? " · " + row.keyCount + "K" : "";
    return { title: title, sub: (artist + " " + diff + keys).trim() };
  }

  function matchesName(row, needle) {
    if (!needle) return true;
    var n = needle.toLowerCase();
    var hay = [row.title, row.artist, row.difficultyName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.indexOf(n) !== -1;
  }

  function filteredRows() {
    var key = state.keymode === "" ? null : Number(state.keymode);
    return allRows.filter(function (row) {
      if (!matchesName(row, state.name)) return false;
      if (key != null && row.keyCount !== key) return false;
      return true;
    });
  }

  function sortValue(row, sort) {
    switch (sort) {
      case "map":
        return ((row.title || "") + "\\0" + (row.difficultyName || "")).toLowerCase();
      case "importStar":
        return row.importedStarRating;
      case "baseStar":
        return row.baseline.starRating;
      case "expStar":
        return row.experiment.starRating;
      case "deltaStar":
        return row.delta.starRating;
      case "basePp":
        return row.baseline.ppSs;
      case "expPp":
        return row.experiment.ppSs;
      case "deltaPp":
        return row.delta.ppSs;
      default:
        return null;
    }
  }

  function sortedRows(rows) {
    var sort = state.sort;
    var order = state.order;
    var dir = order === "desc" ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var av = sortValue(a, sort);
      var bv = sortValue(b, sort);
      if (sort === "map") {
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      }
      var aNull = av == null;
      var bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      var at = (a.title || "").toLowerCase();
      var bt = (b.title || "").toLowerCase();
      if (at < bt) return -1;
      if (at > bt) return 1;
      return 0;
    });
  }

  function comparable(rows) {
    return rows.filter(function (r) {
      return (
        r.delta.starRating != null &&
        r.baseline.error == null &&
        r.experiment.error == null
      );
    });
  }

  function summarize(rows) {
    var comp = comparable(rows);
    var starDeltas = comp
      .map(function (r) { return r.delta.starRating; })
      .filter(function (v) { return v != null; });
    var ppDeltas = comp
      .map(function (r) { return r.delta.ppSs; })
      .filter(function (v) { return v != null; });
    var topStar = comp
      .slice()
      .sort(function (a, b) {
        return Math.abs(b.delta.starRating || 0) - Math.abs(a.delta.starRating || 0);
      })
      .slice(0, 10);
    var topPp = comp
      .slice()
      .sort(function (a, b) {
        return Math.abs(b.delta.ppSs || 0) - Math.abs(a.delta.ppSs || 0);
      })
      .slice(0, 10);
    return {
      totalMatches: rows.length,
      comparedCount: comp.length,
      missingBaseline: rows.filter(function (r) { return !r.cached.baseline; }).length,
      missingExperiment: rows.filter(function (r) { return !r.cached.experiment; }).length,
      meanDeltaStarRating: mean(starDeltas),
      medianDeltaStarRating: median(starDeltas),
      meanDeltaPpSs: mean(ppDeltas),
      medianDeltaPpSs: median(ppDeltas),
      histogram: buildHistogram(starDeltas),
      topStarMovers: topStar,
      topPpMovers: topPp,
    };
  }

  function renderHeader() {
    document.getElementById("header-meta").textContent =
      meta.baselineLabel +
      " vs " +
      meta.experimentLabel +
      " · generated " +
      new Date(meta.generatedAt).toLocaleString();
    document.getElementById("header-query").textContent = meta.query;
  }

  function renderKeymodes() {
    var keys = {};
    for (var i = 0; i < allRows.length; i++) {
      var k = allRows[i].keyCount;
      if (k != null) keys[k] = true;
    }
    var list = Object.keys(keys)
      .map(Number)
      .sort(function (a, b) { return a - b; });
    var sel = document.getElementById("keymode-filter");
    for (var j = 0; j < list.length; j++) {
      var opt = document.createElement("option");
      opt.value = String(list[j]);
      opt.textContent = list[j] + "K";
      sel.appendChild(opt);
    }
  }

  function renderStats(summary) {
    var items = [
      { label: "Matches", value: String(summary.totalMatches) },
      { label: "Compared", value: String(summary.comparedCount) },
      { label: "Mean Δ★", value: fmtDelta(summary.meanDeltaStarRating, 3) },
      { label: "Median Δ★", value: fmtDelta(summary.medianDeltaStarRating, 3) },
      { label: "Mean ΔPP", value: fmtDelta(summary.meanDeltaPpSs, 1) },
      { label: "Median ΔPP", value: fmtDelta(summary.medianDeltaPpSs, 1) },
      { label: "Missing base", value: String(summary.missingBaseline) },
      { label: "Missing exp", value: String(summary.missingExperiment) },
    ];
    document.getElementById("stats").innerHTML = items
      .map(function (it) {
        return (
          '<div class="stat"><div class="label">' +
          escapeHtml(it.label) +
          '</div><div class="value">' +
          escapeHtml(it.value) +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderHistogram(bins) {
    var max = 0;
    for (var i = 0; i < bins.length; i++) {
      if (bins[i].count > max) max = bins[i].count;
    }
    document.getElementById("histogram").innerHTML = bins
      .map(function (b) {
        var h = max > 0 ? Math.max(2, Math.round((b.count / max) * 120)) : 2;
        return (
          '<div class="hist-bar-wrap">' +
          '<div class="hist-count">' +
          b.count +
          "</div>" +
          '<div class="hist-bar" style="height:' +
          h +
          'px"></div>' +
          '<div class="hist-label">' +
          escapeHtml(b.label) +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderMovers(elId, rows, kind) {
    var el = document.getElementById(elId);
    if (!rows.length) {
      el.innerHTML = '<div class="empty">No comparable rows.</div>';
      return;
    }
    el.innerHTML = rows
      .map(function (r) {
        var label = mapLabel(r);
        var delta =
          kind === "star"
            ? fmtDelta(r.delta.starRating, 3)
            : fmtDelta(r.delta.ppSs, 1);
        var cls =
          kind === "star"
            ? deltaClass(r.delta.starRating)
            : deltaClass(r.delta.ppSs);
        var link = webLink(r);
        var titleHtml = link
          ? '<a href="' +
            escapeHtml(link) +
            '" target="_blank" rel="noopener">' +
            escapeHtml(label.title) +
            "</a>"
          : escapeHtml(label.title);
        return (
          '<div class="mover"><div>' +
          titleHtml +
          ' <span class="map-sub">' +
          escapeHtml(label.sub) +
          '</span></div><div class="delta ' +
          cls +
          '">' +
          escapeHtml(delta) +
          "</div></div>"
        );
      })
      .join("");
  }

  function sortArrow(col) {
    if (state.sort !== col) return "";
    return '<span class="arrow">' + (state.order === "asc" ? "▲" : "▼") + "</span>";
  }

  function renderThead() {
    var cols = [
      { id: "map", label: "Map", cls: "" },
    ];
    if (meta.usesImport) {
      /* Import ★ hidden when baseline already uses import SR */
    } else {
      cols.push({ id: "importStar", label: "Import ★", cls: "num" });
    }
    cols = cols.concat([
      { id: "baseStar", label: meta.baselineLabel + " ★", cls: "num" },
      { id: "expStar", label: meta.experimentLabel + " ★", cls: "num" },
      { id: "deltaStar", label: "Δ★", cls: "num" },
      { id: "basePp", label: "Base PP", cls: "num" },
      { id: "expPp", label: "Exp PP", cls: "num" },
      { id: "deltaPp", label: "ΔPP", cls: "num" },
      { id: "link", label: "Link", cls: "" },
    ]);
    document.getElementById("thead").innerHTML =
      "<tr>" +
      cols
        .map(function (c) {
          if (c.id === "link") {
            return "<th>" + escapeHtml(c.label) + "</th>";
          }
          return (
            '<th class="sortable ' +
            c.cls +
            '" data-sort="' +
            c.id +
            '">' +
            escapeHtml(c.label) +
            sortArrow(c.id) +
            "</th>"
          );
        })
        .join("") +
      "</tr>";

    var ths = document.querySelectorAll("#thead th.sortable");
    for (var i = 0; i < ths.length; i++) {
      ths[i].addEventListener("click", function (ev) {
        var col = ev.currentTarget.getAttribute("data-sort");
        if (state.sort === col) {
          state.order = state.order === "asc" ? "desc" : "asc";
        } else {
          state.sort = col;
          state.order = col === "map" ? "asc" : "desc";
        }
        state.page = 1;
        render();
      });
    }
  }

  function renderTable(rows) {
    var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(start, start + PAGE_SIZE);
    var empty = document.getElementById("empty");
    var tbody = document.getElementById("tbody");

    if (!pageRows.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
    } else {
      empty.hidden = true;
      tbody.innerHTML = pageRows
        .map(function (r) {
          var label = mapLabel(r);
          var cover = coverUrl(r);
          var link = webLink(r);
          var err =
            r.baseline.error || r.experiment.error
              ? '<div class="err">' +
                escapeHtml(r.baseline.error || r.experiment.error) +
                "</div>"
              : "";
          var coverHtml = cover
            ? '<img class="cover" src="' +
              escapeHtml(cover) +
              '" alt="" loading="lazy" onerror="this.removeAttribute(\\'src\\')"/>'
            : '<div class="cover"></div>';
          var importCell = meta.usesImport
            ? ""
            : '<td class="num">' +
              escapeHtml(fmtNum(r.importedStarRating, 2)) +
              "</td>";
          var linkHtml = link
            ? '<a class="btn" href="' +
              escapeHtml(link) +
              '" target="_blank" rel="noopener">osu!</a>'
            : '<span class="btn" aria-disabled="true">osu!</span>';
          return (
            "<tr>" +
            '<td><div class="map-cell">' +
            coverHtml +
            '<div><div class="map-title">' +
            escapeHtml(label.title) +
            '</div><div class="map-sub">' +
            escapeHtml(label.sub) +
            "</div>" +
            err +
            "</div></div></td>" +
            importCell +
            '<td class="num">' +
            escapeHtml(fmtNum(r.baseline.starRating, 2)) +
            "</td>" +
            '<td class="num">' +
            escapeHtml(fmtNum(r.experiment.starRating, 2)) +
            "</td>" +
            '<td class="num ' +
            deltaClass(r.delta.starRating) +
            '">' +
            escapeHtml(fmtDelta(r.delta.starRating, 3)) +
            "</td>" +
            '<td class="num">' +
            escapeHtml(fmtNum(r.baseline.ppSs, 1)) +
            "</td>" +
            '<td class="num">' +
            escapeHtml(fmtNum(r.experiment.ppSs, 1)) +
            "</td>" +
            '<td class="num ' +
            deltaClass(r.delta.ppSs) +
            '">' +
            escapeHtml(fmtDelta(r.delta.ppSs, 1)) +
            "</td>" +
            "<td>" +
            linkHtml +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }

    document.getElementById("page-info").textContent =
      "Page " +
      state.page +
      " / " +
      totalPages +
      " · " +
      rows.length +
      " maps";
    document.getElementById("prev-page").disabled = state.page <= 1;
    document.getElementById("next-page").disabled = state.page >= totalPages;
  }

  function render() {
    var filtered = sortedRows(filteredRows());
    var summary = summarize(filtered);
    renderStats(summary);
    renderHistogram(summary.histogram);
    renderMovers("star-movers", summary.topStarMovers, "star");
    renderMovers("pp-movers", summary.topPpMovers, "pp");
    renderThead();
    renderTable(filtered);
  }

  document.getElementById("name-filter").addEventListener("input", function (ev) {
    state.name = ev.target.value.trim();
    state.page = 1;
    render();
  });
  document.getElementById("keymode-filter").addEventListener("change", function (ev) {
    state.keymode = ev.target.value;
    state.page = 1;
    render();
  });
  document.getElementById("prev-page").addEventListener("click", function () {
    if (state.page > 1) {
      state.page--;
      render();
    }
  });
  document.getElementById("next-page").addEventListener("click", function () {
    state.page++;
    render();
  });

  renderHeader();
  renderKeymodes();
  render();
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
