# Frontend UI analysis — `apps/server/public/**`

Audit date: 2026-08-24. Several things were checked and found healthy:
SSE invalidation scoping and listener cleanup (`lib/sse.ts`), tosu polling
gated on SSE-down with backstop, virtualized download grid
(`@tanstack/react-virtual`), server-capped session lists (100) and paginated
practice lists (24/page), stable query keys preventing out-of-order fetch
clobbers, UTC-consistent chart day labels.

---

## F1. Rewatch-mode HUD loop calls `setHud` every animation frame

**Severity: critical** — verified
**File:** `apps/server/public/components/ScoreReplayModal.tsx:895-942`.

```tsx
function tick() {
  ...
  for (const j of judgments) { if (j.tMs > t) break; ... }   // O(all judgments)
  setHud({ combo, accuracy, last });                          // new object every frame
  raf = requestAnimationFrame(tick);
}
```

Unlike the play-mode loop (lines ~550-582), which correctly gates updates on
changed judgment count/combo, the rewatch loop allocates a fresh HUD object
and re-renders the entire ~1700-line modal subtree (seek bar, stats,
NotefieldStage/StdPlayfield props, analysis panel) at display refresh rate —
**even while audio is paused** — plus an O(judgments) scan per frame on dense
charts.

**Fix:** Track `lastCombo/judgedCount/lastT` in closure locals and call
`setHud` only when values changed; skip entirely when paused and time is
unchanged. Extract the combo/acc overlay into an isolated memoized child so
ticks don't reconcile the whole dialog.

## F2. Single 1.58 MB JS entry bundle; zero route-level code splitting

**Severity: high** — verified output chunk `apps/server/dist/public/index-*.js`
= 1,579,020 bytes; no `React.lazy`/dynamic import anywhere in `public/**`
despite `splitting: true` in `scripts/build-ui.ts`. All ~20 routes (recharts
Stats/Dashboard, replay video exporter, Marathon, Hub admin…) parse on first
paint of any page.

**Fix:** Lazy-load heavy routes/modals (`StatsPage`, `DashboardPage`,
`ScoreReplayModal` + `replayVideoExport`, `DownloadMapsPage`,
`RatingLabPage`, `MarathonPage`, pattern browser). The bundler will emit
shared chunks automatically.

## F3. O(n) chart scans duplicated in the render body of the replay modal

**Severity: medium** — `ScoreReplayModal.tsx:281-297, 969-986, 1016-1020`:
two full passes over all notes/hitObjects (+taiko/catch variants) plus
`resolveKeybinds` run inline on *every* render, compounding F1's per-frame
re-renders into proportional garbage production. Wrap in
`useMemo(…, [replayData])`; memoize binds on `[keybindsAll, columnCount]`.

## F4. Canvas notefield repaints at full FPS while paused/idle; no visibility pause

**Severity: medium** — `components/ManiaNotefield.tsx:181-204`: unconditional
`clearRect` + full repaint per frame whenever the loop runs, regardless of
input changes or `document.hidden`. Keep `lastPaintedTMs/mask` refs and
early-return when unchanged; cancel on `visibilitychange`, resume on visible.
(DPR handling itself is fine.)

## F5. Batch-download ETA clock restarts when the page opens mid-batch

**Severity: medium (logic)** — `features/download/useMirrorBatchJob.ts:110-118`
+ `batchProgress.ts:70-81`: `startedAtMs` is "when the UI first saw the job",
not job start; `processed` includes pre-open downloads → opening the page
halfway through a run collapses ETA to "~seconds left" until samples accrue.
The hook mounts globally via AppShell, so this hits on any reload during a
batch. Use the server-provided `batch.startedAt` as the ETA epoch; keep local
clock only as fallback.

## F6. Terminal-phase batch shows "Estimating…" forever

**Severity: low (logic)** — `batchProgress.ts:70-76` returns "Estimating…"
when `processed >= queued` while still busy; `formatEtaMs`'s "Almost done"
branch is unreachable from this path. Return a "Wrapping up…" label for that case.

## F7. `readStored()` (localStorage + JSON.parse) executed on every render

**Severity: low** — `features/download/DownloadMapsPage.tsx:135`: runs per
render (keystrokes, poll-driven re-renders every 1 s during batches). Use
lazy state init: `const [initial] = useState(readStored)`.

## F8. `formatRelativeTime` hardcodes English strings

**Severity: low (i18n logic gap)** — `lib/format.ts:44-52` ("just now",
"5m ago") bypasses the i18n dictionary used everywhere else; visible on
Dashboard/Sessions/practice pages for non-English locales. Add dict keys with
plural templates and route through the existing `t()` wrapper.

## F9. SSE error handling has no fatal-error detection or backoff

**Severity: low** — `lib/sse.ts:178-182` relies solely on browser auto-
reconnect: permanent failures (404/auth wall/server removed) retry forever at
browser-default cadence with the status chip stuck "connecting". Inspect
`source.readyState === CLOSED` after error → manual reconnect with exponential
backoff + jitter, surface persistent "live updates unavailable" state.
(Listener lifecycle itself is clean.)

## Summary (top 3)

1. **F1** gate rewatch `setHud` on value change — 3-line fix, biggest CPU win.
2. **F2** lazy-load heavy routes to break up the 1.58 MB bundle.
3. **F4** canvas dirty-check + visibility pause so idle screens cost nothing.
