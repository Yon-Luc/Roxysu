# Roxysu web UI — in-depth issue analysis

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Default branch reviewed:** `master`  
**Commit:** `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`  
(“Update the docs site download links to v0.1.23.”, 2026-11-03 16:34 Europe/Lisbon)  
**App version:** `0.1.23` (`apps/server/package.json`)  
**UI stack:** React 19, TanStack Router (hash history), TanStack Query 5, Recharts 3, Tailwind 4, `@tanstack/react-virtual`  
**Review date:** 2026-11-17  
**Clone used:** `/workspace/Roxysu` (read-only; this document lives outside the repo)

This document is a source review of the product React UI in `apps/server/public`, with emphasis on the pages osu!mania players use to analyse their play (Home, Stats, Beatmaps / practice profiles, Sessions, Now selected, and the replay analysis panel). Suggested patches match the existing TypeScript / React style. They are proposals only — nothing in the repo was modified.

Line numbers refer to that commit.

---

## What was and was not verified

**Verified in source (this commit):** every issue below was re-read in the files cited. A few **data-contract** checks were also made against the server that feeds this UI (not by running the app):

1. Score accuracy is stored and returned as a 0–1 fraction (`formatAccuracy` correctly multiplies by 100; the Stats accuracy-trend chart does the same). This matches `apps/server/src/query-language/compile.ts` (filters divide user-facing percent by 100) and `apps/play`.
2. Axis-specific skill band levels are explicitly zeroed when `playCount < topN` (`bandLevel` in `apps/server/src/analytics/recommend/sevenKSkill.ts`). That is what `historyBandValue` later treats as “fall back to overall.”
3. `GET /api/tosu/live/analysis` returns whatever map is live right now, plus a `checksum` field the UI can check but currently ignores (`getTosuLiveAnalysis` in `apps/server/src/tosu/live.ts`).
4. `GET /api/sessions` returns at most 100 sessions (`listSessions(db, 100)`) plus 371 days of daily activity.
5. `roxy.png` is a 1024×1024 PNG, 1,612,024 bytes, imported into `AppShell` and used as the favicon.

**Not verified (do not treat these as runtime measurements):**

- The UI was not run in a browser or in the packaged Electron shell. Recharts tooltip / animation / `ResponsiveContainer` behaviour follows Recharts 3’s documented defaults plus the props in this tree, not a click-through.
- No live tosu connection, replay file, or player database was used. The Now Selected race and the axis-fallback chart lie are control-flow / data-contract findings.
- React re-render counts, bundle sizes after minify, and chart frame times were not profiled. The 1.6 MB mascot size and the lack of list virtualization / `isAnimationActive={false}` are from the files; the user-visible cost is inferred.
- This is not a review of the server calculators themselves (`@roxysu/mania-difficulty`, rating lab jobs, recommend ranking) except where the UI mis-displays what those APIs already return.
- BMS, Hub, Download, Overlay editor, and Skin pages were scanned for the same classes of bug (races, missing states, i18n, lists) but were not given a note-by-note audit of their domain logic.
- Accessibility was reviewed from markup patterns (labels, `lang`, keyboard on charts), not with a screen reader.

**Already in reasonably good shape (do not re-fix):** context-isolated desktop shell aside, the UI already uses Query `staleTime` plus scoped SSE invalidation (`lib/sse.ts` no longer blasts every key on every event); practice list pagination + `keepPreviousData`; Stats “below the fold” deferral; Download search virtualization; density chart `memo` + unique `gradientId` on Now Selected; loading skeletons and empty/error states on the main analysis pages; `formatChartDay` is intentionally UTC and the weekday/hour charts are labelled as UTC.

---

## Summary table

| ID | Severity | Title | Primary file | Effort |
|----|----------|-------|--------------|--------|
| H1 | High | Skill-evolution chart falls back to overall when a Rice/LN/FLN value is 0 | `features/stats/statsHelpers.ts` | Small (1–2 h) + a unit test |
| H2 | High | Now Selected can show another map’s density / pattern analysis | `features/now-selected/NowSelectedPage.tsx` | Small (1–2 h) |
| M3 | Medium | Density-over-time chart: categorical clocks, monotone overshoot, tooltip never shows pattern or peak chord | `components/mania-analysis/DensityOverTimeChart.tsx` | Small–medium (2–4 h) |
| M4 | Medium | Stats (and several other tools) default to 7K; session recommend only offers 4K/7K | `router.tsx`, `features/sessions/SessionSuggest.tsx` | Small–medium |
| M5 | Medium | Practice search/sort live only in `localStorage`, not the URL | `features/practice/PracticeListPage.tsx`, `lib/practiceSearch.ts` | Medium (half day) |
| M6 | Medium | Sessions calendar click can say “no sessions” for a day that has plays; list capped at 100 with no hint | `features/sessions/SessionsPage.tsx`, `SessionActivityCalendar.tsx` | Medium |
| M7 | Medium | 1.6 MB 1024² `roxy.png` is the favicon and the sidebar icon | `roxy.png`, `components/AppShell.tsx`, `index.html` | Small (export a 64–192 px asset) |
| M8 | Medium | Recharts default animations, almost no list virtualization, almost no `memo` | Stats / Sessions / Practice / Replay | Medium, can land incrementally |
| M9 | Medium | Session activity calendar is Sunday-start and UTC-day, with “Mon” as the first visible label | `features/sessions/SessionActivityCalendar.tsx` | Small–medium |
| L1 | Low | i18n holes: hardcoded English errors, replay analysis, `html lang="en"`, English chart month/weekday names | several | Small, ongoing |
| L2 | Low | `PatternDensityHints` keys do not match chart-shape names (jack never suppressed; “stream” shown as “delay”) | `features/practice/PracticeProfilePage.tsx` | Small |
| L3 | Low | No router `errorComponent` / React error boundary on page routes | `router.tsx`, `components/AppShell.tsx` | Small |
| L4 | Low | Activity calendar grid is computed once on mount and goes stale at UTC midnight | `SessionActivityCalendar.tsx` | Small |
| L5 | Low | Home (`DashboardPage`) is lazy, but Practice / Sessions / Collections are eager in the main bundle | `router.tsx` | Small |
| L6 | Low | Replay timing histogram clamps ±100 ms into edge bins; column heat ignores LN-tail misses | `lib/replayPatterns.ts` | Small |
| L7 | Low | Relative times, miss labels, and some preview errors are untranslated / un-pluralized | `lib/format.ts`, preview/replay modals | Small |

---

## App structure

The product UI is a single-page app served by `apps/server` at `/` (Electron loads `http://127.0.0.1:4321/`). Routing is hash-based so the Bun static server does not need an SPA fallback.

```
osu!lazer / tosu (optional live)
        |
apps/server  -- REST + SSE -->  React UI (apps/server/public)
        |
SQLite (synced from Realm)
```

### Routes and pages (under `AppShell`, except overlay)

| Route | Page | Role for a mania player |
|-------|------|-------------------------|
| `#/` | `DashboardPage` (lazy) | Sync status, weekly activity, recent scores |
| `#/stats` | `StatsPage` (lazy) | Skill bands, pattern shapes, skill evolution, accuracy/activity, “how you play,” top mappers. Search: `granularity`, `skillTopPlays`, `skillAxis`, `keyCount` (defaults to **7**) |
| `#/practice` | `PracticeListPage` (eager) | Searchable / filterable beatmap library, best-score distribution chart |
| `#/practice/$beatmapId` | `PracticeProfilePage` (eager) | Map header, rework dan, pattern + density profile, sessions, score timeline |
| `#/sessions` | `SessionsPage` (eager) | Current session, recent list, activity calendar |
| `#/sessions/$sessionId` | `SessionDetailPage` (eager) | Live or historical session, scores, share card, 4K/7K recommend, tosu panel |
| `#/now-selected` | `NowSelectedPage` (eager) | Live selected map: density, weights, hotspots, personal stats, preview |
| `#/collections` | Collections (eager) | Smart + Realm collections |
| `#/download-maps` | Download (lazy) | Mirror search; **the only virtualized list** |
| `#/marathon` | Marathon (lazy) | Hidden from nav (`HIDDEN_NAV`) |
| `#/hub`, `#/hub/$id`, … | Hub (mixed) | Community collections |
| `#/rating-lab` | Rating Lab (lazy) | Hidden in the desktop shell |
| `#/dev/parity` | Mania parity (lazy) | Dev-only |
| `#/skin`, `#/settings` | Skin / Settings (lazy) | Skins, jobs, keybinds, rating display |
| `#/bms`… | BMS (lazy) | Separate community mode |
| `#/overlay` | `OverlayPage` (lazy, no shell) | OBS / overlay host |
| `#/overlay-editor` | Overlay editor (lazy) | Layout editor |

### Shared UI and data

| Piece | Role |
|-------|------|
| `app.tsx` | `QueryClient` (`staleTime: 60_000`, `retry: 1`), `connectLiveUpdates`, `SyncFocusBridge` |
| `lib/api.ts` | Eden treaty client, `unwrap()` throws on `{ error }` |
| `lib/sse.ts` | `EventSource("/api/events")` → scoped query invalidation |
| `lib/format.ts` / `lib/i18n.ts` / `lib/language.ts` | Number/time formatting and `@roxysu/i18n` dictionary (`en`, `fr`, `es`, `pt`) |
| `lib/chartStyles.ts` | Theme-aware Recharts colours (reads CSS variables) |
| `lib/ratingDisplay.ts` | osu! stars vs rework dan / star |
| `components/mania-analysis/*` | Density chart, pattern weights, hotspots (practice profile + Now Selected) |
| `components/ScoreReplayModal.tsx` + `ReplayAnalysisPanel.tsx` | Replay notefield + timing / column / miss-pattern analysis |
| `components/AppShell.tsx` | Sidebar, mobile tab bar, command palette, sync chip, `Suspense` fallback |

**State and fetching:** almost all server data goes through TanStack Query. SSE is the freshness path; a few jobs poll (`refetchInterval` while running). Practice search, recommend tabs, rating-lab query, and sidebar open are `localStorage`. Stats filters are in the URL. There is no Redux / Zustand store.

**Charts:** Recharts 3 only (`LineChart`, `BarChart`, `AreaChart`, `ResponsiveContainer`). No `isAnimationActive={false}` anywhere in `apps/server/public`. `@tanstack/react-virtual` is used only in `DownloadSearchGrid.tsx`. `React.memo` appears twice; `useMemo` is used in the heavier pages.

---

## Recommended fix order

Land the two High items first — they make skill and density readouts lie to the player. Then the chart and keymode defaults, which are the next thing a mania main will notice.

1. **H1** — stop substituting overall skill for a missing Rice/LN/FLN history point. Add a unit test next to `statsHelpers.ts`. One PR.
2. **H2** — ignore / recache tosu analysis only when `payload.checksum` matches the selected map. Same PR is fine if you want, but it is a different page.
3. **M3** — density chart: numeric time axis, `type="linear"`, hidden series (or a custom tooltip) for pattern + peak chord. Optionally turn off monotone on the Stats skill / accuracy lines in the same pass.
4. **M4** — default Stats `keyCount` to the player’s most-played (or first `availableKeyCounts`) keymode; extend session recommend beyond 4K/7K, or label the limitation.
5. **M7** — shrink the mascot asset. Tiny, immediate load-time win on every page (including overlay? favicon only).
6. **M5** — put practice `q` / sort / page in the hash search so chart-bar filters, back, and shared links work.
7. **M6 + M9 + L4** — sessions calendar: local weekday start, say UTC or use local days, paginate or query sessions-for-day, recompute “today” after midnight.
8. **M8** — `isAnimationActive={false}` on all Recharts series; virtualize “show all sessions” and long miss lists; memoize `ScoreCard` / chart cards.
9. **L1, L2, L3, L5, L6, L7** — i18n, hints, error boundary, bundle split, replay histogram footnotes. Quality and polish.

Suggested grouping if you want fewer PRs: (H1), (H2), (M3), (M4), (M7), (M5), (M6+M9+L4), (M8), (L1+L2+L7), (L3+L5).

---

## H1 — Skill-evolution chart falls back to overall when a Rice/LN/FLN value is 0

**Severity:** High (wrong data on the main skill graph)

### Where

`features/stats/statsHelpers.ts` maps each history point when the Stats page’s axis toggle is Rice, LN, or FLN:

```102:119:apps/server/public/features/stats/statsHelpers.ts
export function historyBandValue(
  point: NonNullable<PlayerStats["skillHistory"]>[number],
  band: "push" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number {
  if (axis === "all") return point[band];
  const key = `${band}${axis.charAt(0).toUpperCase()}${axis.slice(1)}` as
    | "pushRc"
    | "pushLn"
    | "pushFln"
    | "accuracyRc"
    | "accuracyLn"
    | "accuracyFln"
    | "consistencyRc"
    | "consistencyLn"
    | "consistencyFln";
  const axisValue = point[key];
  return axisValue > 0 ? axisValue : point[band];
}
```

`StatsPage` then feeds those numbers straight into a three-line Recharts chart titled “Skill evolution · Rice/LN/FLN”:

```130:137:apps/server/public/features/stats/StatsPage.tsx
  const chartHistory = useMemo(
    () =>
      history.map((point) => ({
        at: point.at,
        push: historyBandValue(point, "push", skillAxis),
        accuracy: historyBandValue(point, "accuracy", skillAxis),
        consistency: historyBandValue(point, "consistency", skillAxis),
      })),
    [history, skillAxis],
  );
```

The API already zero-fills an axis when that band does not have enough plays. In `sevenKSkill.ts`:

```569:577:apps/server/src/analytics/recommend/sevenKSkill.ts
  const bandLevel = (band: { level: number; playCount: number }) =>
    band.playCount >= topN && band.level > 0 ? band.level : 0;
  // ...
    peakRc: bandLevel(clear.rc),
    peakLn: bandLevel(clear.ln),
    peakFln: bandLevel(clear.fln),
```

History points are produced with `coldStartFromPlaysOnly: true`, one estimate per UTC day/week end, so early points (and any later point where an axis still has fewer than `skillTopPlays` maps) legitimately have `pushLn === 0` (etc.) while `push` (overall) is already a real number.

### What happens and why

1. The player opens Stats, leaves or selects e.g. **LN**, and looks at Skill evolution.
2. For each day, if LN Push is 0 (not enough LN maps in the top-N window yet, or no LN plays at all as of that day), the helper substitutes **overall** Push — which is dominated by whatever they actually played (often rice).
3. The line is also `type="monotone"`, so those substituted points are smoothed into the real LN segment. The graph can show a high “LN skill” in a period where the API is explicitly saying “no LN estimate,” then a sudden correction once enough LN maps exist.
4. The same substitution applies to Accuracy and Consistency series, and to Rice / FLN.

Root cause: `0` is being treated as “missing, please invent a value” instead of “no estimate for this axis.” Falling back to the *overall* series is the wrong stand-in even if a fallback were wanted; a carry-forward of the last *axis* value, or a gap, is the honest option.

The current-skill cards above the chart do **not** do this (they show `—` when the value is 0). Only the evolution chart lies.

### Impact

- **Analysis:** a 4K/7K player comparing Rice vs LN vs FLN progress will misread their weaker axis. This is one of the main reasons to open Stats.
- **Trust:** the toggle is labelled as an axis filter; the line is not that axis.
- **Performance:** none.

### How to reproduce or verify

Static verification is done (the `> 0 ? axis : overall` branch and the API zeroing rule). To see it in the running app (not run in this review):

1. Use a profile that has plenty of rice clears and few LN clears, or a high Top-plays count (e.g. 50) so LN is still below the floor for early history.
2. Open `#/stats?keyCount=7&skillAxis=ln` (or 4).
3. Compare a day where the LN card still shows `—` / “n/required” with the same day’s LN line on Skill evolution. If the line is up at the overall level, this bug is showing.

Add a unit test around `historyBandValue` with `{ push: 8, pushLn: 0 }` and `axis: "ln"` — today it returns `8`.

### Proposed fix

Return `null` when the axis has no estimate, type the chart rows as `number | null`, and let Recharts break the line (`connectNulls={false}`, the default). Do **not** fall back to `point[band]`.

```ts
export function historyBandValue(
  point: NonNullable<PlayerStats["skillHistory"]>[number],
  band: "push" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number | null {
  if (axis === "all") return point[band] > 0 ? point[band] : null;
  const key = `${band}${axis.charAt(0).toUpperCase()}${axis.slice(1)}` as
    | "pushRc"
    | "pushLn"
    | "pushFln"
    | "accuracyRc"
    | "accuracyLn"
    | "accuracyFln"
    | "consistencyRc"
    | "consistencyLn"
    | "consistencyFln";
  const axisValue = point[key];
  return axisValue > 0 ? axisValue : null;
}
```

Optional: if you would rather show a *step* (skill held constant until the next estimate), walk the series and carry forward the last positive axis value, still without mixing in overall. That is a product choice; gapping is the conservative default.

Also consider `type="linear"` on those `Line`s (see M3). Monotone interpolation plus substituted points is what creates fake hills.

### Trade-offs

- Gaps look “broken” if a player expects a continuous LN line from day one. A footnote already exists for cold start; a one-line hint under the chart (“No line means that axis did not have enough plays yet”) would help.
- Carry-forward is smoother but can hide that they simply did not play LN for months.

### How to test

- Unit tests for `all` / `rc` / `ln` / `fln`, including `0` and a positive axis value that is *different* from overall.
- On a fixture with only rice history, the LN evolution chart should be empty or gapped, not a copy of All.
- Current-skill cards and the chart must agree: if the card is `—`, that day should not plot a number.

---

## H2 — Now Selected can show another map’s density / pattern analysis

**Severity:** High (wrong chart on the live analysis page)

### Where

`NowSelectedPage` loads the live density profile with a checksum in the **query key**, but the request itself is always “whatever is selected now,” and the result is rendered without checking the payload checksum:

```123:155:apps/server/public/features/now-selected/NowSelectedPage.tsx
  const checksum = data?.beatmap?.checksum ?? null;
  const analysisQuery = useQuery({
    queryKey: ["tosu", "live", "analysis", checksum],
    queryFn: fetchTosuLiveAnalysis,
    enabled:
      Boolean(checksum) &&
      data?.status === "connected" &&
      !data.analysis.analyzing,
    staleTime: 60_000,
  });
  // ...
  const patternDetail = analysisQuery.data?.detail ?? null;
```

```889:893:apps/server/public/lib/api.ts
export async function fetchTosuLiveAnalysis() {
  return unwrap(
    await api.api.tosu.live.analysis.get(),
    "/api/tosu/live/analysis",
  );
}
```

The server returns the checksum of the analysis it actually built:

```123:128:apps/server/src/tosu/live.ts
export function getTosuLiveAnalysis(): TosuLiveAnalysisPayload {
  return {
    checksum: patternDetailChecksum,
    matchedBeatmapId,
    detail: patternDetail,
  };
}
```

React Query v5 will **not** abort the in-flight `fetch` when `checksum` changes unless the `queryFn` uses `query.signal`. There is no `AbortController` here. `staleTime: 60_000` then keeps a poisoned cache entry for a minute.

Now Selected is otherwise careful: the density chart gets a unique `gradientId`, live `play` is stripped from the main query to cut re-renders, and widgets hide when `patternDetail.error` is set. The race is only this fetch/cache pairing.

### What happens and why

Typical song-select path:

1. Map A is selected. Query key `[…, checksumA]` starts. The server begins (or returns) analysis for A.
2. The player arrows to map B before that response lands. A new query with key `checksumB` starts. The first request is still in flight.
3. If, by the time the **first** request returns, tosu/the server has already moved to B, the body is B’s analysis (`checksum: B`) but React Query writes it under **key A**.
4. Later, when the player returns to A (or the cache is reused within 60 s), Now Selected paints B’s density series, pattern weights, and hotspots on A’s identity header.

The same class of mix-up can happen in the other direction (a request started for B returning A’s then-current payload, stored under B).

Root cause: the cache key is “the map we *meant*,” the response is “the map that was live when the handler ran,” and the render path never reconciles the two even though the field is already in the JSON.

### Impact

- **Analysis:** NPS curve, peak chord, shape weights, and “hotspots” can belong to a different chart than the title/artist/key count above them. That is the page’s whole job during practice.
- **Worse with DT/rate or keymode changes** in song select: a 4K stream map can briefly (or for a minute) show a 7K jack profile.
- **Performance:** not the issue; the extra request is fine.

### How to reproduce or verify

Static verification is done. Runtime (not run here): connect tosu, open `#/now-selected`, hover quickly across several library maps with obviously different densities (a long LN chordjack vs a low-NPS stream). Watch whether the density title/NPS peak can lag onto the wrong jacket. DevTools → React Query cache for `["tosu","live","analysis", …]` and compare `data.checksum` to the key.

### Proposed fix

1. **Never render a mismatch.** This is the minimum:

```tsx
const patternDetail =
  analysisQuery.data?.checksum &&
  analysisQuery.data.checksum === checksum
    ? analysisQuery.data.detail
    : null;
```

2. **Do not cache a mismatch.** In `queryFn`, if the payload checksum does not equal the key, throw or return a sentinel so React Query does not store it as success for that key. Pass `signal` from the query context and ignore aborted errors.
3. **Optional API:** `GET /api/tosu/live/analysis?checksum=…` should 409 or return `{ pending: true }` when the live map is not that checksum, instead of silently returning a different chart.

Keep showing the existing “Analyzing…” chip until the matching payload arrives.

### Trade-offs

- Strict matching means a brief empty density widget while skipping maps — better than a wrong curve.
- Tightening the API is more work but fixes any other client that might grow the same call.

### How to test

- Unit-test a small hook or helper: `selectDetail(payload, checksum)` returns `null` on mismatch.
- Component or integration: start a delayed mock of `/api/tosu/live/analysis` for map A that resolves with B’s checksum; the A key must not display B’s samples.
- Slow-arrow through song select and confirm weights/hotspots only update when the checksum matches the header.

---

## M3 — Density-over-time chart: categorical clocks, monotone overshoot, tooltip never shows pattern or peak chord

**Severity:** Medium (misleading / incomplete graph on every mania map profile)

### Where

`components/mania-analysis/DensityOverTimeChart.tsx` is the NPS curve on the practice profile (`ManiaPatternDetailPanel`) and on Now Selected.

The X axis is the formatted clock string, not milliseconds:

```71:78:apps/server/public/components/mania-analysis/DensityOverTimeChart.tsx
          <XAxis
            dataKey="timeLabel"
            tick={charts.tick}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
            interval="preserveStartEnd"
          />
```

`timeLabel` is `formatClock(sample.startMs)` → `m:ss` with the seconds floored. The series is:

```120:128:apps/server/public/components/mania-analysis/DensityOverTimeChart.tsx
          <Area
            type="monotone"
            dataKey="notesPerSecond"
            stroke={charts.chart}
            fill={`url(#${gradientId})`}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
```

The tooltip `formatter` *knows about* peak chord and pattern:

```95:118:apps/server/public/components/mania-analysis/DensityOverTimeChart.tsx
            formatter={(value, name, item) => {
              if (name === "notesPerSecond") {
                return [
                  `${Number(value).toFixed(1)} NPS`,
                  detail?.tooltipDensity ?? "Density",
                ];
              }
              if (name === "peakChordSize") { /* ... */ }
              // ...
              if (name === "displayPattern") { /* ... */ }
              return [String(value), String(name)];
            }}
```

but those fields are never added as `<Area>` / `<Line>` series (not even `legendType="none"` hidden ones). Recharts’ default tooltip only walks the series, so the branches for pattern and peak chord are dead. The label formatter correctly shows `startMs–endMs` from the payload, so the window itself is fine.

The same `type="monotone"` choice is used on Stats skill evolution and the accuracy-trend line (`StatsPage.tsx` around 531–661).

### What happens and why

1. **Categorical time.** Recharts treats `timeLabel` as a category equally spaced in index order. If sample windows are not uniform (they often are not, at the start/end of a chart or around breaks), the curve is horizontally distorted. Two samples that start in the same second (`1:23` and `1:23`) collapse to the same category label and can look like a vertical spike or a collision.
2. **Monotone interpolation.** d3’s monotone cubic can overshoot local min/max. On an NPS curve that is exactly what a player uses to find hard sections, so a fake peak between two real samples is a logic issue, not just a style one. The same overshoot applies to skill and accuracy lines.
3. **Incomplete tooltip.** Hover only shows NPS. The subtitle promises a “chart-first read on density, hotspots, and pattern makeup,” and each sample already has `dominantPattern`, `secondaryPattern`, and `peakChordSize` in the payload — they just never appear.

`formatClock` also has no hour component; maps longer than 60 minutes render as `75:00`. Rare for ranked mania, possible for practice dumps.

### Impact

- Players hunting a density spike or a chordjack section can mis-time it, or not see the pattern at all without scrolling the hotspot list.
- Skill/accuracy evolution (H1’s chart) can also grow false hills between days.

### How to reproduce or verify

Static: only one `<Area dataKey="notesPerSecond">`; X axis is `timeLabel`; `type="monotone"`. On a long map with sub-second windows, look for duplicate `m:ss` ticks. Hover a peak: no pattern / `nK` line in the tooltip.

### Proposed fix

```tsx
const chartData = useMemo(
  () =>
    samples.map((sample) => ({
      ...sample,
      // keep startMs as the axis; label in the tick/tooltip
      displayPattern: formatPatternLabel(
        sample.dominantPattern ?? "mixed",
        detail?.patterns,
      ),
      displaySecondary: sample.secondaryPattern
        ? formatPatternLabel(sample.secondaryPattern, detail?.patterns)
        : null,
    })),
  [samples, detail?.patterns],
);

<AreaChart data={chartData}>
  <XAxis
    dataKey="startMs"
    type="number"
    domain={["dataMin", "dataMax"]}
    tickFormatter={formatClock}
    tick={charts.tick}
    minTickGap={36}
  />
  <Tooltip
    labelFormatter={(_, payload) => {
      const sample = payload?.[0]?.payload;
      return sample
        ? `${formatClock(sample.startMs)} – ${formatClock(sample.endMs)}`
        : "";
    }}
    formatter={(value, name, item) => { /* unchanged branches */ }}
  />
  <Area type="linear" dataKey="notesPerSecond" /* ... */ />
  <Line dataKey="peakChordSize" stroke="none" legendType="none" dot={false} />
  <Line dataKey="displayPattern" stroke="none" legendType="none" dot={false} />
</AreaChart>
```

Use `type="linear"` on Stats `Line`s in the same change. For clocks past 60 minutes, extend `formatClock` to `h:mm:ss`.

### Trade-offs

- Hidden series are a Recharts-ism; a custom tooltip component is cleaner if the hidden-line trick ever shows a `0` or `undefined` row.
- A numeric axis can look sparse on very short maps; `minTickGap` already handles that.

### How to test

- Two samples with the same floored second but different `startMs` must plot at different x positions.
- A 2-second gap in sampling should take twice the width of a 1-second window.
- Tooltip on a known chordjack peak shows the pattern label and peak chord (e.g. `4K`).
- A V-shaped NPS 10 → 2 → 10 must not peak above 10 in the middle (linear vs monotone).

---

## M4 — Stats (and several other tools) default to 7K; session recommend only offers 4K/7K

**Severity:** Medium (wrong default keymode; 5/6/8/9/10K players left out)

### Where

The Stats route hard-codes 7 when the URL has no `keyCount`:

```165:170:apps/server/public/router.tsx
    const rawKeys = Number(search.keyCount);
    const keyCount =
      Number.isFinite(rawKeys) && rawKeys >= 1 && rawKeys <= 18
        ? Math.round(rawKeys)
        : 7;
    return { granularity, skillTopPlays, skillAxis, keyCount };
```

The page *does* render a toggle from `data.availableKeyCounts` once the payload arrives (`StatsPage.tsx` 325–331), but the **first request** is already `fetchStats({ keyCount: 7 })`. A 4K-only player sees empty / cold-start 7K skill until they notice the `4K` chip.

Session suggestions are explicitly 4K or 7K only:

```8:10:apps/server/public/features/sessions/SessionSuggest.tsx
type SuggestTab = "up-next" | "7k" | "4k";
const TABS: SuggestTab[] = ["up-next", "7k", "4k"];
```

```87:90:apps/server/public/features/sessions/SessionSuggest.tsx
          <SessionSevenKRecommend
            key={tab === "4k" ? 4 : 7}
            keyCount={tab === "4k" ? 4 : 7}
```

`RecommendKeyCount = 4 | 7` in `SessionSevenKRecommend.tsx`. Collection generation and marathon also default to 7 (`GenerateCollectionsModal.tsx` line 90; `MarathonPage.tsx` maps a reference key count to “4 or else 7”).

The density / pattern panel on a practice profile *does* work for every mania key count (the API name `sevenKAnalysis` is historical; i18n strings are already generic “Density profile”). The recommend UI is the part that is still 4K/7K-shaped.

### What happens and why

The product’s skill model is keymode-scoped (correct — 4K and 7K skill are not comparable). The URL default and the recommend tabs nevertheless assume a 7K main. 4K players get a first paint of the wrong mode; 6K/8K/9K players have Stats if they click their chip, but no “maps to play next” tab at all.

### Impact

- First visit to Stats can look like “you have no skill data” for a 4K main.
- Mid-keymode and 9K/10K players cannot use the session coach, which is the in-session analysis loop.

### How to reproduce or verify

Open `#/stats` with no search on a profile whose `availableKeyCounts` is `[4]` or `[4,8]`. The request and the toggle’s selected value are 7 until a click. Open a live session and look at Suggest: only Up next / 7K / 4K.

### Proposed fix

1. **Stats default.** After the first `fetchStats` (or a cheap `availableKeyCounts` endpoint), if the URL omitted `keyCount`, `navigate` to the most-played keymode (the API already lists them; if you also return a `preferredKeyCount`, use that). Until then, you can avoid flashing 7K by not requesting skill until the preferred key is known, or by reading a `localStorage` key written from the last toggle (same pattern as `skillTopPlays`).
2. **Recommend.** Generalize `RecommendKeyCount` to the same 1–18 range as Stats, and build the tab list from `availableKeyCounts` (or a compact select when there are many). Keep 4 and 7 as shortcuts if you want.
3. **Copy.** Where a tool still only supports 4 and 7, say so in the empty state instead of offering a 7K list that is just empty.

### Trade-offs

- Auto-navigating `keyCount` once can surprise someone who bookmarked `#/stats` intending 7K; only do it when the param was omitted.
- More recommend keymodes is a server question if `/api/practice/recommend` already takes `keyCount` (it does in the client call). Confirm the backend accepts 5, 6, 8, …

### How to test

- No `keyCount` in the URL + only 4K plays → first skill request is 4, toggle shows 4K selected.
- Explicit `#/stats?keyCount=7` on a 4K main stays on 7K.
- Session suggest shows an 8K tab (or a key select) when 8K plays exist, and recommendations come back with `key=8`.

---

## M5 — Practice search/sort live only in `localStorage`, not the URL

**Severity:** Medium (broken share / back / “open in practice” flows)

### Where

`#/practice` has no `validateSearch`. The list page keeps `q`, `page`, `sortBy`, `sortDir`, and `metric` in React state, persisted with `writeStoredPracticeSearch` (`lib/practiceSearch.ts`, key `roxysu:practice-search`).

Stats rank bars “open in practice” by writing that same key and then navigating:

```82:99:apps/server/public/lib/practiceSearch.ts
export function openInPractice(query: string) {
  try {
    const raw = localStorage.getItem(PRACTICE_SEARCH_KEY);
    const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(
      PRACTICE_SEARCH_KEY,
      JSON.stringify({ ...prev, q: query, page: 1 }),
    );
  } catch { /* ... */ }
}
```

```735:745:apps/server/public/features/stats/StatsPage.tsx
                      onClick={(_data, index) => {
                        const rank = ranks[index];
                        if (!rank || rank.count === 0) return;
                        openInPractice(
                          buildStatsGradeQuery(keyCount, skillAxis, rank.label),
                        );
                        void navigate({ to: "/practice" });
                      }}
```

The distribution chart on the practice list mutates `q` the same way (`applySearch(..., { fromChart: true })`) and keeps an in-memory undo stack that dies on unmount.

Returning to `/practice` re-reads storage in a `useEffect` keyed on `pathname` (lines 199–208).

### What happens and why

- The back button after a chart-bar filter does **not** restore the previous query (the path is still `/practice`). Undo exists only if you have not left the page.
- A copied `#/practice` link does not include the query a teammate or future-you needs.
- `openInPractice` from Stats is a side effect on `localStorage`. If the write fails (private mode) or a second tab races, you land on the unfiltered list. Two tabs cannot hold two different searches.
- After visiting a profile and going “back,” scroll restoration may work, but a mid-edit search box can be reset from storage when `pathname` becomes `/practice` again.

Stats already does this correctly with `validateSearch` + `navigate({ search })`. Practice does not.

### Impact

- The intended loop “see a grade bucket or a density range → inspect those maps → go back” is unreliable.
- Query-language filters (the feature that makes the list an analysis tool) cannot be bookmarked.

### How to reproduce or verify

Set a query, click a distribution bar, press the browser back button: the URL never changed, so the filter stays. Copy the URL, open a clean profile / private window: the list is unfiltered (or shows *that machine’s* last search).

### Proposed fix

Add `validateSearch` on `practiceRoute` (`q`, `page`, `sortBy`, `sortDir`, `metric`) with the same clamp/default logic already in `readStoredPracticeSearch`. Drive the page from `useSearch()` / `navigate({ search })`. Keep `localStorage` only as a default when the search is empty (so returning users still see their last filter). Change `openInPractice` to `navigate({ to: "/practice", search: { q: query, page: 1 } })`.

### Trade-offs

- Longer hash URLs; that is normal for this app (`#/stats?keyCount=7&skillAxis=ln` already exists).
- Migrating storage → URL once on first visit needs a small “if search empty, hydrate from storage and replaceState” effect so existing users are not reset.

### How to test

- Changing the sort or page updates the hash; reload preserves it.
- Back after a distribution click restores the previous `q`.
- Clicking a Stats rank bar lands on `#/practice?q=key%3D7%20grade%3AS` (or similar) even with `localStorage` blocked.

---

## M6 — Sessions calendar click can say “no sessions” for a day that has plays; list capped at 100 with no hint

**Severity:** Medium (history looks empty; calendar and list disagree)

### Where

The sessions index fetches one unpaginated payload. The server caps the list at 100:

```144:154:apps/server/src/routes/sessions.ts
    const [items, current, activity] = await Promise.all([
      listSessions(db, 100),
      getCurrentSession(db),
      getDailyActivity(db, 371),
    ]);
```

The calendar paints **371 days** of `activity`, but a day click filters only `data.items`:

```29:37:apps/server/public/features/sessions/SessionsPage.tsx
    if (selectedDay) {
      return data.items.filter(
        (s) => sessionStartedUtcDay(s.startedAt) === selectedDay,
      );
    }
    if (showAll) return data.items;
    return data.items.slice(0, DEFAULT_VISIBLE);
```

```165:170:apps/server/public/features/sessions/SessionsPage.tsx
        ) : visibleItems.length === 0 ? (
          <p className="text-sm text-muted">
            {dict?.session.noSessionsOnDay ?? "No sessions on this day."}
          </p>
```

“Show all” means “show all of the 100,” not all sessions. There is no “load more,” no total count, and no note about the cap. `sessionStartedUtcDay` is UTC (`toISOString().slice(0, 10)`), which also disagrees with a player’s local calendar in DST (see M9).

### What happens and why

A year of practice can easily exceed 100 sessions. The heat map still shows older days (daily activity is independent). Clicking a green day from month 5 returns “No sessions on this day” because that session aged out of the list. The player is told the day is empty, which is false.

### Impact

- The calendar’s stated job is “Click a day to filter the list above.” That promise fails for anything older than the 100 most recent sessions.
- Session review — a core analysis habit — silently drops history.

### How to reproduce or verify

Static: 100 vs 371 is in the route; the filter is in-memory. Runtime: on a database with >100 sessions, click a heat-map day that is not in the current list.

### Proposed fix

- Show the cap: “Showing the 100 most recent sessions.” Do not claim a day is empty if `activity` has plays for that day — say “Sessions from this day are not in the loaded window” and offer a link.
- Better: `GET /api/sessions?day=YYYY-MM-DD` (and a paginated list) so a click always loads that day’s sessions. The calendar can stay on the 371-day activity aggregate.
- If you keep a single list, raise the cap or virtualize a larger page (M8) and still paginate.

### Trade-offs

- A per-day endpoint is more work but is the only way the 53-week calendar actually works.
- Loading thousands of session rows into the client “to make Show all real” is the wrong fix (see M8).

### How to test

- Fixture: 120 sessions, 3 of them on a day 101+ back. The cell is green; click shows those 3 (or an honest overflow message), never “No sessions on this day.”
- “Show all” on a 20-session account still shows 20; the cap hint is hidden.

---

## M7 — 1.6 MB 1024² `roxy.png` is the favicon and the sidebar icon

**Severity:** Medium (every page pays a huge image)

### Where

```
apps/server/public/roxy.png   1,612,024 bytes, 1024×1024 PNG
```

It is imported into the shell that wraps almost every route, used as the document icon, and referenced by the service worker and replay-video export:

- `components/AppShell.tsx` line 52 — sidebar / header avatar (`size-10`, 40 px)
- `features/dashboard/DashboardPage.tsx` line 37 — home header, also 40 px
- `features/sessions/SessionShareCard.tsx` — share-image watermark (higher res is more reasonable)
- `lib/replayVideoExport.ts` line 95 — video watermark
- `index.html` line 6 — `<link rel="icon" href="./roxy.png">`
- `sw.js` — precaches `/roxy.png`

Purpose-built icons already exist and are much smaller: `icons/icon-192.png` (32 KB), `icons/apple-touch-icon.png` (29 KB), `icons/icon-512.png` (182 KB).

### What happens and why

A 1024 px lossless mascot is decoded and often bundled or fetched in full to draw a 40 px circle on every authenticated page, and the browser downloads the same file for the tab icon. The service worker precache makes first-load / update cost worse. This is independent of React render performance and shows up even on Dashboard’s loading skeleton (the `<img>` is in the loading branch too).

**Not measured here:** whether the UI bundler emits the 1.6 MB file as a hashed asset or whether Electron’s cache hides it after the first launch. The byte size and the 40 px usage are verified.

### Impact

- Slow first paint and extra memory on low-end machines, including the desktop app’s local UI.
- Share/export can keep the full-res asset; the chrome should not.

### Proposed fix

Export `roxy-32.png` / `roxy-192.png` (or WebP/AVIF) and point `index.html`, `AppShell`, and `DashboardPage` at the small file. Leave `roxy.png` (or a mid-res copy) for `SessionShareCard` and video export only. Update `sw.js` to precache the small icon. Prefer `icons/icon-192.png` as the favicon if you do not want a new export.

### Trade-offs

- One more asset to keep in sync when the mascot changes. A tiny build step that resizes `roxy.png` avoids drift.

### How to test

- Network panel: favicon and sidebar image are tens of kilobytes, not 1.6 MB.
- Share-card and replay export still look sharp at their output resolution.
- Desktop and PWA icons still resolve.

---

## M8 — Recharts default animations, almost no list virtualization, almost no `memo`

**Severity:** Medium (jank on the analysis pages when data is large or live)

### Where

- **Recharts:** a repo search of `apps/server/public` finds **zero** `isAnimationActive`. Every `Line` / `Bar` / `Area` uses the library default (animate on mount and on data change). Stats alone mounts half a dozen charts; practice mounts a distribution bar chart; the density profile mounts an area chart. Live session updates and SSE invalidations retrigger them.
- **Lists:** `@tanstack/react-virtual` is used only in `DownloadSearchGrid.tsx`. Unvirtualized maps include:
  - Practice list: 24 cards per page (acceptable) but each card has a cover image + several computed rating labels, and the parent is not `memo`’d.
  - Sessions “show all”: up to 100 rows (M6).
  - Session detail scores: 50, with “load more,” each a `ScoreCard`.
  - Practice profile score timeline: all `recentScores`.
  - Replay miss list: every simulated miss (`ReplayAnalysisPanel.tsx`, `max-h-48` on small screens only).
  - Collections, Hub browse, Rating Lab’s 48-row table, Stats mapper table.
- **Memoization:** `React.memo` is used twice (`DensityOverTimeChart` is one). `useMemo` appears in the heavier pages, but `ScoreCard`, `HotspotsList`, `PatternWeightsPanel`, chart cards, and practice list items are plain functions. `useChartStyles()` returns a new-stable object per theme, which is fine; inline `formatter` lambdas on every Recharts `Tooltip` are not stable.

`StatsPage` already defers below-the-fold charts with `belowFoldReady` (timeout 0) — a good pattern to keep.

### What happens and why

Recharts animations are CSS/JS work on every data swap. On a live session or after sync, the dashboard / stats / density curves replay their entrance. Combined with large unvirtualized lists (100 sessions, a 1,000-miss dump, a mapper table), scrolling and typing (command palette, practice search) can hitch. This was not frame-timed in this review; the finding is the missing standard guards in a chart-heavy analysis UI.

### Impact

- Jank on the pages players leave open during a session (Home, Sessions, Now Selected, Stats).
- Replay analysis of a long, poor run can mount a very large miss DOM list.

### Proposed fix

1. Set `isAnimationActive={false}` (and `animationDuration={0}` if needed) on every Recharts series, or wrap a tiny `<RxLine>` helper so the default is off.
2. Virtualize the sessions “show all” list, the replay miss list above ~50 rows, and the rating-lab compare table. The download grid is the local example.
3. `memo(ScoreCard)` and practice list items; stabilize tooltip formatters with `useCallback`.
4. Keep `belowFoldReady` (or `requestIdleCallback`) for Stats charts.

### Trade-offs

- Turning animation off is flatter; it is the right default for data-heavy dashboards.
- Virtualization is more work for variable-height session rows — start with a fixed row height.

### How to test

- DevTools performance: toggling Stats axis or receiving a `score.imported` event should not run a 400–800 ms chart animation.
- 100-session “show all” and a replay with several hundred misses: only a window of rows in the DOM.
- Visual regression on chart appearance (no leftover animation offset).

---

## M9 — Session activity calendar is Sunday-start and UTC-day, with “Mon” as the first visible label

**Severity:** Medium (easy to misread when you practised)

### Where

```43:50:apps/server/public/features/sessions/SessionActivityCalendar.tsx
  let start = addUtcDays(today, -(weeks * 7 - 1));
  start = addUtcDays(start, -start.getUTCDay());
```

`Date#getUTCDay()` is 0 on Sunday, so the first row is Sunday. The weekday gutter is:

```5:5:apps/server/public/features/sessions/SessionActivityCalendar.tsx
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;
```

and the comment on line 167 says “Rows = weekday (Sun→Sat).” “Mon” is the **first visible** label, on the second row. Month labels and day keys are UTC (`toLocaleString(..., { timeZone: "UTC" })`, `sessionStartedUtcDay` uses `toISOString()`).

The grid is also built once:

```115:115:apps/server/public/features/sessions/SessionActivityCalendar.tsx
  const cells = useMemo(() => buildWeekGrid(weeks), []);
```

(see L4.)

By contrast, Stats “Plays by weekday / hour” charts are honestly titled “UTC” (`StatsPage.tsx` 809 and 838). The sessions calendar title is just “Activity.”

For a user in Europe/Lisbon: in winter the zone is UTC+0 and the day key matches; in summer (WEST, UTC+1) a session started at 00:30 local lands on the previous UTC day. Many other Roxysu users will always be offset.

### What happens and why

A Monday-first reader (common in Europe) can treat the unlabeled top row as Monday and then be confused that the next row is also labelled Mon — or, worse, shift every habit by one day. Late-night sessions in DST vanish from “today.” Filtering (M6) uses the same UTC day key, so the list and the cell stay consistent with each other and inconsistent with the wall clock.

### Impact

- “Did I practise yesterday?” is a core question on this page and can be off by a day.
- Not a security issue; it is a trust/UX issue for analysis.

### Proposed fix

- Start the week on Monday for locales that do (`Intl.Locale.weekInfo` or a simple `Europe/*` / `startOfWeek` setting). Label Sunday as well, or label every row, so the first visible word is not “Mon” on row 2 of a Sunday-start grid.
- Either bucket activity in **local** time (preferred for a personal calendar) or keep UTC and put “(UTC)” in the title, like Stats.
- Use the same day-key helper for `activity`, `sessionStartedUtcDay`, and the grid.

### Trade-offs

- Local bucketing means a travel day can split oddly; that is still what people expect of a habit calendar.
- Changing week start will shift cached mental maps for existing users; worth a short changelog note.

### How to test

- In `Europe/Lisbon` in summer, a session at 00:30 local appears on that local date.
- With Monday-start, the top row is Monday and labels are Mon/Wed/Fri (or all seven).
- A fixture on Sunday 23:30 UTC is not painted as Monday in a UTC+1 locale if you adopt local days.

---

## L1 — i18n holes: hardcoded English errors, replay analysis, `html lang="en"`, English chart names

**Severity:** Low (polish / a11y; the main analysis pages are otherwise translated)

### Where

The app has a real dictionary (`en` / `fr` / `es` / `pt`) and `useAppDict`, but several player-facing strings never go through it:

- `DashboardPage.tsx` 80: `Failed to load dashboard: …` (Stats/Practice/Sessions use `t(dict?.…)` for the same situation).
- `ReplayAnalysisPanel.tsx`: the entire panel (“Analysis”, “Timing”, “Columns”, “Miss patterns”, “Clean — no simulated misses.”, fidelity warning) is English-only.
- `BeatmapPreviewModal.tsx` ~1045–1050: “Preview failed to load” / “Failed to load preview.”
- `ScoreReplayModal.tsx` ~1349: “Failed to load replay.”
- `index.html` line 2: `<html lang="en">`. `setLanguage` never updates `document.documentElement.lang`.
- `format.ts` `CHART_MONTHS` is a hard-coded English `Jan`…`Dec`. Session calendar `WEEKDAY_LABELS` is English. Stats weekday labels come from the server as `["Sun",…,"Sat"]` (`playerStats.ts` 601).
- `formatMisses`: always `"${value}x miss"` (no plural, no i18n). `formatRelativeTime` jumps from “Nd ago” to `toLocaleDateString()` at 30 days (no weeks), and “just now” / “m ago” have dictionary fallbacks but the function still mixes English defaults.

### Proposed fix

Move the error and replay-analysis strings into `packages/i18n` next to the existing `practice.detail` / `session` keys. In `setLanguage` / `useLanguage`, set `document.documentElement.lang`. Format chart months and weekdays with `Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })`. Pluralize misses via the dictionary.

### Trade-offs

- Server-provided weekday labels should either be numeric `day` (0–6) formatted on the client, or the server must be locale-aware (client-side is easier).

### How to test

Switch to French: Home error, replay analysis, preview failure, and chart ticks should not stay in English; `<html lang>` should be `fr`.

---

## L2 — `PatternDensityHints` keys do not match chart-shape names

**Severity:** Low (secondary hint text on the practice profile)

### Where

```543:559:apps/server/public/features/practice/PracticeProfilePage.tsx
  const dominant = pattern.dominantPattern === "stream" ? "delay" : pattern.dominantPattern;
  const add = (label: string, value: number | null, key: string) => {
    if (value == null || value < 0.08 || key === dominant) return;
    hints.push(`${hintWords?.[label] ?? fallback[label]} ${Math.round(value * 100)}%`);
  };
  add("jack", pattern.jackDensity, "jack");
  add("chord", pattern.chordDensity, "chordjack");
  add("delay", pattern.streamDensity, "delay");
  add("bracket", pattern.bracketDensity, "bracket");
```

The caller passes `dominantPattern: patternAnalysis.shapePattern || sevenKAnalysis?.shapePattern` (lines 416–419). Shape names come from `shapesForKeyCount` (`stream`, `trill`, `jumptrill`, `jumpstream`, `handstream`, `chordjack`, `bracket`, `anchor`, `shield`, `tech`, … — `packages/mania-difficulty/src/shape.ts`). **`jack` is a skill label, not a shape**, so `key === dominant` is never true for the jack row. A chordjack map hides the “chord” hint (good) but can still show a “jack 12%” line. “stream” is renamed to “delay” before comparison — a 7K community term that is odd on a 4K stream map (the title already says Stream; the hint is about *other* densities, so this mostly affects the label if stream is *not* dominant… actually if stream *is* dominant it is suppressed as delay. If stream is secondary, the hint prints “delay 20%” on a 4K jumpstream map).

### Proposed fix

Compare against the real shape name (`stream`, not `delay`). Suppress jack density when the shape is `chordjack` (and maybe `anchor`). Use keymode-aware labels (`stream` vs `delay`) via the same `formatPatternLabel` / `hintWords` tables already used in the panel. Skip the whole hint row when its family is the title shape.

### How to test

A 4K jumpstream map with high stream density should not say “delay.” A chordjack map should not also list jack at 8%+ if that is the same family.

---

## L3 — No router `errorComponent` / React error boundary on page routes

**Severity:** Low (a render throw whitescreens the shell)

### Where

`router.tsx` registers no `errorComponent`, `notFoundComponent`, or `defaultErrorComponent`. `AppShell` only wraps children in `<Suspense fallback={<PageHeaderSkeleton />}>` (line 489). `QueryClient` has `retry: 1` but that only covers fetch failures, which most pages already display. A throw in a chart tick formatter, a `null.toFixed` (e.g. `beatmap.bpm.toFixed(0)` on the practice profile header if `bpm` were ever null), or a Recharts domain of all-null data, takes down the whole shell: no nav, no back.

**Not runtime-verified:** a specific crash was not forced. The finding is the absence of a boundary on a chart-heavy UI.

### Proposed fix

Set `defaultErrorComponent` / `defaultNotFoundComponent` on `createRouter` (or on `appRoute`) to a small “This page hit an error — back to Home” panel that keeps `AppShell` mounted. Optionally wrap each Recharts card so one chart failure does not kill Stats.

### How to test

Temporarily throw in `DashboardPage` after load; the sidebar must stay, and a retry / home link must work.

---

## L4 — Activity calendar grid is computed once on mount and goes stale at UTC midnight

**Severity:** Low

`buildWeekGrid` is memoized with `[]` (`SessionActivityCalendar.tsx` 115). “Today” and the `future` flag are frozen for the life of the page. A desktop user who leaves Sessions open overnight will see yesterday as today, and the new day is either missing or marked future.

Recompute at a midnight timeout (local or UTC, matching M9) or include a `todayKey` in the hook deps and refresh it on a timer / `visibilitychange`.

---

## L5 — Home (`DashboardPage`) is lazy, but Practice / Sessions / Collections are eager in the main bundle

**Severity:** Low (bundle inversion)

`router.tsx` eagerly imports `PracticeListPage`, `PracticeProfilePage`, `SessionsPage`, `SessionDetailPage`, `CollectionsPage`, `CollectionResultsPage`, `NowSelectedPage`, and `HubCallbackPage`. `DashboardPage` — the index route — is `lazy()`. First load of `#/` therefore waits on a Dashboard chunk, while the large practice/session modules (Recharts, cards, calendars, recommend) are already in the main graph.

Eager-load Dashboard (or at least a thin home) and lazy-load practice/sessions/collections/now-selected. Watch for a slightly slower first visit to `/practice`.

---

## L6 — Replay timing histogram clamps ±100 ms into edge bins; column heat ignores LN-tail misses

**Severity:** Low (footnote / honesty on replay analysis)

```219:224:apps/server/public/lib/replayPatterns.ts
    const clamped = Math.min(
      HIST_HALF_RANGE - 0.001,
      Math.max(-HIST_HALF_RANGE, e),
    );
    const idx = Math.floor((clamped + HIST_HALF_RANGE) / binWidth);
```

Hits (or late LNs) beyond ±100 ms are counted in the edge bins, so the histogram can show tall walls at ±100 that are really “worse than 100.” Mean / stddev still use the unclamped values (good), but the picture disagrees with μ/σ.

Column heat increments `missCount` only when `j.result === "miss" && !j.isTail` (lines 268–269). LN-drop misses still appear in the miss list and “LN drop” tag, so a lane can look clean in the heat row and full of drops below.

### Proposed fix

Add an overflow bin or hatch the ±100 edges and mention it under the chart. Either count tail misses in heat (maybe a second tint) or label the heat row “note misses (heads only).”

### How to test

A synthetic replay with many +150 ms hits should not pile into the +97.5 ms bar without a visual cue. A column with only LN-tail misses should not look perfectly white if the list shows drops there.

---

## L7 — Relative times, miss labels, and some preview errors are untranslated / un-pluralized

**Severity:** Low (overlaps L1; listed so it does not get lost in format.ts)

`formatMisses` returns `FC` or `${value}x miss`. `formatScore` / `toLocaleString()` follow the browser locale (good) but not the in-app language if those differ. `formatRelativeTime(..., dict?.common)` is used well on most analysis pages; a few call sites still pass nothing. Preview/replay failure strings are listed under L1.

Fix with the L1 dictionary pass; add a one-line unit test for 0 / 1 / 2 misses.

---

## Page-by-page notes (mania analysis)

These are leftover observations that did not rise to their own ID. Anything unverified is marked.

### Home (`DashboardPage`)

Weekly activity uses `formatChartDay` (UTC) but the card title is not labelled UTC (unlike Stats). Recent scores, accuracy, and PP formatting are consistent with the 0–1 accuracy contract. Loading skeletons are good. Error string is L1. The 40 px mascot is M7.

### Stats (`StatsPage` + `PatternShapesSection` + `SkillCard`)

Main skill cards show `—` when the API value is 0; that matches `bandLevel`. Axis breakdown cells also require `maps >= requiredPlays` (redundant if the API already zeroed, but safe). Pattern “best / weakest” needs two qualified shapes — a reasonable empty state. Rank-distribution clicks go through `openInPractice` (M5). Accuracy-trend Y domain floors 5 points under the worst day and caps at 100 — good for 98%+ players. `skillAxis` is a client filter of one payload (not a missing query-key bug). Default 7K is M4; evolution fallback is H1; monotone is M3.

### Beatmaps list (`PracticeListPage`)

Pagination (24), `keepPreviousData`, distribution-after-list `enabled`, skeletons, and query-language help are solid. The distribution chart is a useful analysis widget; its filters dying on back is M5. `interval={0}` on the X axis is fine for a small bin count. Cards are not virtualized (acceptable at 24).

### Beatmap profile (`PracticeProfilePage`)

Density panel is shown for every mania key count; copy is already “Density profile,” not “7K.” Rework dan / osu! rating modes are consistent. `beatmap.bpm.toFixed(0)` assumes `bpm` is always a number — if the type ever allows null, this throws (L3). Session links use `"current"` for an open session (correct). Pattern hints are L2. Score cards list `recentScores` without a cap in the UI (depends on the API).

### Sessions list + calendar

Covered by M6, M9, L4. The current-session hero and empty states are clear. “Show all” should not be a full-history promise.

### Session detail + recommend

Live vs historical `staleTime` is thought through. Fresh-score highlighting cleans up its timeout. Share-image fetch of up to 500 scores is capped; no pagination past that on the card (acceptable). Recommend is 4K/7K only (M4). Exclude-already-played is client-side and avoids refetch (good). `FOCUS_OPTIONS` hint fallbacks are English (L1).

### Now Selected

Checksum race is H2. Density `gradientId` is unique (good). Tosu off / connecting / waiting empty states are good. Widgets can hide individually. `http://${data.host}/files/beatmap/background` is fetched in the browser — fine on localhost; worth remembering if the UI is ever exposed beyond the machine.

### Replay modal + analysis

`buildReplayAnalysis` is `useMemo`’d (good). Fidelity warning at 2 percentage points (`FIDELITY_ACC_DELTA = 0.02`) is conservative and clearly labelled “practice signal only.” Histogram clamp and tail-miss heat are L6. The panel is English-only (L1). Miss list virtualization is M8. Notefield painting itself was not performance-profiled (`paintManiaNotefield.ts` is large but RAF-batched via `playfieldRaf.ts`).

### Collections / Download / Hub / Rating Lab / Overlay / Settings / BMS

Download search is the virtualization reference implementation. Collections and Hub lists are unvirtualized (usually fine). Rating Lab compare is a 48-row table with server sort; `ppAccuracy` is written to `window.location.search` (the real query string) while the app is hash-routed — a hash link like `#/rating-lab?ppAccuracy=99.5` will **not** be read by `readStoredPpAccuracy` (it uses `URLSearchParams(window.location.search)`). Rating Lab is also hidden in the desktop shell. Overlay polls with `refetchIntervalInBackground: true` (intentional for OBS). These were not given a domain-logic audit.

---

## Already fine (short)

- Accuracy is consistently a 0–1 fraction in the UI formatters and the Stats trend chart (`* 100` only when plotting percent).
- SSE invalidation is scoped; practice keys are marked stale with `refetchType: "none"` so a live import does not yank the list mid-browse.
- Query error / empty / loading states exist on Dashboard, Stats, Practice, Sessions, and the profile.
- `formatChartDay` and the “plays by hour/weekday” cards are explicitly UTC; do not “fix” those ticks to local without also changing the titles and the server buckets.
- Density chart `memo` and Now Selected’s custom `gradientId` already avoid a duplicate-SVG-id trap.

---

## Review limits, again

No runtime click-through, no profiler traces, no live tosu or replay file. H1 and H2 are the two findings where the code + API contract already demonstrate a wrong value on an analysis graph; please still reproduce once on a real library before merging a behavioural change.
