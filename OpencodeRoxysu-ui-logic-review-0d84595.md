# Roxysu UI and domain logic — re-review of `play/rune-migration` at `0d84595`

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Branch reviewed:** `play/rune-migration`  
**Commit:** `0d845951ffb59bb1b1e8486927f5f965311510a2`  
(“Add comprehensive overlay review and enhance desktop integration”, 2026-11-23 00:10 Europe/Lisbon)  
**Compared against previous reviews at:** `a07a7f50ac880df36ef842b9d83bb64922ab3f90`  
**App version:** still `0.1.23` (`apps/server/package.json`)  
**UI stack:** React 19, TanStack Router (hash history), TanStack Query 5, Recharts 3.9.2, Tailwind 4, `@tanstack/react-virtual`  
**Review date:** 2026-11-23 (Europe/Lisbon)  
**Worktree used:** `/workspace/rx-ui-logic-0d84595` (detached `HEAD` at the commit above; read-only; this document lives outside the repo)  
**Prior reviews:** `/workspace/Roxysu-rune-ui-review.md` and `/workspace/Roxysu-rune-logic-review.md` (commit `a07a7f5`)  
**User correction carried forward:** a lazer perfect score is also 1,000,000. Logic **M9** stays **Low** (only modded perfects with a multiplier below 1, e.g. NF/EZ/HT, are in question, and that interaction is still unverified).

This is a source re-review of the product React UI in `apps/server/public` and of the mania analysis domain logic, with a deep pass over the code this commit actually changed. Suggested patches match the existing TypeScript / React style. They are proposals only — nothing in the repo was modified or pushed (a local `bun install` was used only to run unit tests).

Line numbers refer to `0d84595`.

---

## Summary table (still-open and new)

| ID | Area | Sev. | Title | Status at `0d84595` |
|----|------|------|-------|---------------------|
| **N3** | Now Selected preview | **Medium** | First wheel tick (and Pause) while tosu is driving the clock can snap to a lagging `audio.currentTime` (up to ~2 s) | **New** |
| UI-N1 | Sessions | **Medium** | Sessions index loads every session (no cap, no virtualization) | Still open |
| **N4** | Preview / replay clock | **Medium** | `AudioClock` never corrects lag under 250 ms, so the interpolator can drift; the 400 ms seek lock can expire before a slow seek lands | **New** |
| L-M8 | Stats / recommend | Medium | “Recency” weight on comfort skill is inverted | Still open |
| L-M4 | Home | Medium | Weekly activity still mixes keymodes and averages fails into accuracy | Still open (partial) |
| L-M3 | Home | Medium | Snapshot today / 7 days / streak stay UTC; streak still starts at the last play day | Still open (partial) |
| L-M12 | Cross-cutting | Medium | SQL nomod filter bans Classic; JS allows it | Still open |
| UI-M7 | Share / video export | Medium | 1.6 MB `roxy.png` still bundled into share cards and replay video export | Still open (partial) |
| UI-M8 | Lists / charts | Medium | Practice / Sessions lists still not virtualized; remaining chart animation only partly addressed | Still open (partial) |
| UI-M3 | Density chart | Medium | Density X axis is still categorical (tooltip / linear already fixed) | Still open (partial) |
| L-N1 | Replay / live | Low | Classic convert maps never pass `convert: true` into hit windows | Still open |
| L-N2 | Stats | Low | Stats weekly-activity bars still omit idle weeks (Home no longer does) | Still open |
| UI-N2 | Stats | Low | First Stats visit paints and fetches 7K, then jumps to `preferredKeyCount` | Still open |
| **N5** | Stats skill evolution | **Low** | Tight Y domain clips the min/max stroke; focusing a band with no points shows an empty chart | **New** |
| **N6** | Preview / replay i18n | **Low** | “wheel seek · shift 5s” is hardcoded English; Now Selected has no wheel hint; Firefox line-mode scaling is untested for a 3-line notch | **New** |
| L-M9 | Grades | Low | Display grade “X” only at exactly 1,000,000 (only modded perfects affected) | Still open (downgraded) |
| L-L1 | Stats / Home tooltips | Low | Weekly tooltips still have no `formatter` (`totalPp` / 0–1 accuracy still on the datum) | Still open (partial; not runtime-verified) |
| L-L3 | Density | Low | Density downsample is still index-stride | Still open |
| L-L4 | Practice mastery | Low | Mastery blend unchanged | Still open |
| L-L5 | Score cards | Low | `formatPp` still `toFixed(0)` | Still open |
| UI-L5 | Router | Low | Practice, Sessions, and Collections are still eager in the main bundle | Still open |
| UI-L6 | Replay analysis | Low | Histogram clamps ±100 ms into edge bins; column heat ignores LN-tail misses | Still open |
| UI-L1 | i18n | Low | Remaining holes: initial `lang="en"`, missing es/fr/pt keys, English fallbacks; new residual is N6 | Still open (partial) |
| UI-L7 | Miss / relative time | Low | `formatMisses` / relative time still English when callers omit labels | Still open (partial) |

---

## Recommended fix order

1. **N3** — stop `syncClockFromAudio` / `sampleAudioClock` from clobbering a live-sync hold, and seek from the frozen clock time. This is the correctness bug in the feature this commit just shipped.
2. **UI-N1** — put a default cap back on `GET /api/sessions` and virtualize the Sessions list. Still the largest performance regression on the branch.
3. **N4** — correct sub-250 ms lag with a slew / tighter threshold, and keep the seek lock until a sample arrives near the target (with a longer timeout).
4. **L-M8** — weight comfort skill by play time, not by hardest-first index.
5. **L-M4 / L-M3 / L-M12** — Home weekly accuracy and keymode mix; local-day snapshot / streak; Classic nomod SQL/JS agreement.
6. **N5 / N6** — pad the skill-evolution domain, refuse an empty focus, move the wheel hint into the dictionaries, and add `bindWheelSeek` / Firefox-notch tests.
7. Everything else in the table (asset size, density X axis, eager routes, histogram, `formatPp`, convert windows, Stats idle weeks, 7K first paint, remaining i18n).

---

## What this commit changed (UI / logic)

Product-facing work in `0d84595` (relative to `a07a7f5`):

- **Wheel seek** — new `wheelSeek.ts` (+ `wheelSeek.test.ts`) batches wheel deltas on one animation frame. Bound on `BeatmapPreviewEmbed`, `BeatmapPreviewModal` (disabled in Play mode), and `ScoreReplayModal` (disabled in Play mode). Wheel-down seeks later; one Chromium pixel-notch is 250 ms; Shift uses `SKIP_MS` (5 s). `aside` / form controls keep their own wheel behavior. In Now Selected, the first wheel tick while a fresh tosu sample is driving the clock calls `holdAndFreeze()` so further ticks can seek without being pulled back to live time.
- **AudioClock** — pause still freezes at the interpolated time; resume holds until the media pointer moves (or 250 ms) and will not adopt a sample that is still behind; while playing, a sample merely behind the interpolator no longer rewinds the playfield (`SEEK_SNAP_MS = 250`). Seek lock still lasts 400 ms. Tests were expanded.
- **Skill evolution chart** — `skillEvolutionDomain` sets the Y axis from the lowest visible skill level to the highest (or +1 for a flat series). Clicking a line or legend item isolates that band; changing axis, day/week, or key count clears the focus. A wider transparent `LineDrawShape` hit target is layered on the stroke (`LineDrawShape` is a real Recharts 3.9 export; the app depends on `recharts@^3.9.2`, resolved as 3.9.2).
- **Settings** — `OverlayHostSection` adds a free-text Monitor field (`overlayOutput`), wired through `patchSettings` / `data.overlay.output`. New i18n keys exist in **all four** dictionaries (en/es/fr/pt).
- **Knowledge** — `knowledge/features/{stats,preview-replay,now-selected}` document the new domain and wheel/hold behaviour.

Overlay-rs, desktop `main.js`, and server overlay-URL plumbing also landed in this commit; they are out of scope here except where the Settings UI and i18n touch them.

Nothing in this commit fixes a previously open UI or logic finding. The new work is additive.

---

## What was and was not verified

**Verified in source at `0d84595`:** every status mark below was re-read in the files cited. Asset sizes were measured on disk (`roxy.png` 1,612,024 bytes; `icons/icon-192.png` 32,374 bytes). i18n key sets were compared across en/es/fr/pt. `LineDrawShape` was checked against Recharts 3.9 documentation and the resolved 3.9.2 package.

**Tests actually run** (after a local `bun install --frozen-lockfile` in the worktree; 26 pass, 0 fail, 63 assertions):

- `apps/server/public/lib/audioClock.test.ts` — 13 pass
- `apps/server/public/components/wheelSeek.test.ts` — 4 pass (only `wheelSeekDeltaMs`)
- `apps/server/public/features/stats/statsHelpers.test.ts` — 9 pass (including 6 new `skillEvolutionDomain` cases)

The full monorepo suite was not run. `bindWheelSeek` itself has no tests (it needs a DOM).

**Not verified (do not treat these as runtime measurements):**

- The UI was not driven in a browser or in the packaged Electron shell. Recharts tooltip contents, line-click bubbling, and wheel events were inferred from source.
- No live tosu connection, replay file, or player database was used. N3 is reasoned from the hold / `pause` / `observe` sequence, not captured on a playfield.
- Firefox’s real `deltaY` in line mode was not measured.
- Logic M9’s interaction with real lazer totals on NF/EZ/HT perfects remains unverified, as in the previous review.

---

## Status of previous UI findings (`a07a7f5` → `0d84595`)

First-round IDs are from `/workspace/Roxysu-ui-review.md`. Status at `a07a7f5` did not change, except L1 picks up a new residual (N6).

| ID | Title | Status | Evidence at `0d84595` |
|----|-------|--------|------------------------|
| H1 | Skill-evolution chart falls back to overall when Rice/LN/FLN is 0 | **Fixed** (unchanged) | `historyBandValue` still returns `null` at `statsHelpers.ts:161,173`. New domain helper skips those nulls. |
| H2 | Now Selected can show another map’s density / pattern analysis | **Fixed** (unchanged) | Live analysis is still keyed by checksum (`NowSelectedPage.tsx:129–132,159`, `selectLivePatternDetail`). |
| M3 | Density chart: categorical clocks, monotone overshoot, poor tooltip | **Still open** (partial) | Tooltip / linear / no animation still in place. X axis is still `dataKey="timeLabel"` (`DensityOverTimeChart.tsx:72,123–124`). Server downsample unchanged (logic L-L3). |
| M4 | Stats (and tools) default to 7K; session recommend only 4K/7K | **Fixed** (residual UI-N2) | `readSkillKeyCount` / `preferredKeyCount` / API `keyCounts` unchanged. First default visit can still start at 7 (`skillKeyCount.ts:2,31–32`; `StatsPage.tsx:169–177`). |
| M5 | Practice search/sort only in `localStorage` | **Fixed** (unchanged) | `parsePracticeSearch` / `validateSearch` still in `router.tsx:249`. |
| M6 | Calendar click can say “no sessions”; list capped at 100 | **Fixed** (unchanged; perf residual is UI-N1) | Day query still `listSessionsOnUtcDay` (`routes/sessions.ts:152`). Index is still `listSessions(db)` with no cap (`routes/sessions.ts:160`). |
| M7 | 1.6 MB `roxy.png` is the favicon and sidebar icon | **Still open** (partial) | Shell / favicon / Dashboard / `sw.js` still use `icons/icon-192.png` (32,374 bytes). `SessionShareCard.tsx:5` and `lib/replayVideoExport.ts:95` still import `roxy.png` (1,612,024 bytes). |
| M8 | Default Recharts animations, almost no list virtualization | **Still open** (partial) | Skill-evolution and density already disable animation. Practice / Sessions / Collections still have no `useVirtualizer`. UI-N1 still makes Sessions worse than `bc3eb6b`. |
| M9 | Session calendar is Sunday-start with “Mon” as the first label | **Fixed** (unchanged) | `weekStartsOnMonday` / `useLocalClock` still in `SessionActivityCalendar.tsx:68,124`. |
| L1 | i18n holes | **Still open** (partial; new residual N6) | `language.ts` still sets `document.documentElement.lang`. `replayAnalysis.fidelity` is already a dictionary key used at `ReplayAnalysisPanel.tsx:100–105` (the English sentence is only the fallback — this residual was slightly overstated at `a07a7f5`). `index.html:2` still ships `lang="en"`. es/fr/pt still lack `settings.onlineScorePull*` (and es also lacks `session.loadMore`) — same gaps as `a07a7f5`. New hardcoded “wheel seek · shift 5s” (N6). The four new `overlayOutput*` keys are present in en/es/fr/pt. |
| L2 | `PatternDensityHints` keys did not match shape names | **Fixed** (unchanged) | Not touched. |
| L3 | No router error / not-found components | **Fixed** (unchanged) | `router.tsx:670–671` still sets `PageError` / `PageMissing`. |
| L4 | Activity calendar grid stale at midnight | **Fixed** (unchanged) | `useLocalClock` unchanged. |
| L5 | Practice / Sessions / Collections eager in the main bundle | **Still open** | `router.tsx:14,16,18` still statically import those pages. |
| L6 | Replay histogram clamps ±100 ms; column heat ignores LN-tail misses | **Still open** | `HIST_HALF_RANGE = 100` (`replayPatterns.ts:61,220–223`). `computeColumnHeat` still skips tail misses (`replayPatterns.ts:268`: `j.result === "miss" && !j.isTail`). The panel already discloses both limits via `replayAnalysis.histogramNote` / `heatNote`. |
| L7 | Relative times, miss labels, some preview errors untranslated | **Still open** (partial) | `formatMisses` still defaults to `"FC"` / `"1 miss"` / `"N misses"` when labels are omitted (`format.ts:27–36`). |
| N1 | Sessions index loads every session | **Still open** | `routes/sessions.ts:160` calls `listSessions(db)` with no limit. `SessionsPage.tsx:30` calls `fetchSessions(undefined, tzOffset)`. No `useVirtualizer` on that page. |
| N2 | First Stats visit paints and fetches 7K, then jumps | **Still open** | `SKILL_KEY_COUNT_DEFAULT = 7` (`skillKeyCount.ts:2`). `StatsPage.tsx:169–177` still applies `preferredKeyCount` only after the 7K payload arrives, and only when `statsKeyCountSource() === "default"`. |

---

## Status of previous logic findings (`a07a7f5` → `0d84595`)

First-round IDs are from `/workspace/Roxysu-logic-review.md`. None of these files were part of the `0d84595` product-logic diff.

| ID | Title | Status | Evidence at `0d84595` |
|----|-------|--------|------------------------|
| H1 | Hit windows do not match lazer | **Fixed** (unchanged) | `packages/mania-judge/src/windows.ts` still has default `DifficultyRange`, Classic, convert, rate floor, EZ/HR. |
| H2 | Weekly `avgAccuracy` uses `playCount` (fails included) | **Fixed** on the Stats path (unchanged) | `playerStats.ts:839,850` still divide by `accCount`. Home weekly residual is M4. |
| H3 | Judgment JSON only lowercase keys | **Fixed** (unchanged) | `packages/db/src/scoreStatistics.ts` still accepts `perfect` / `Perfect` / `"6"`, plus `scoreMissCountSql`. |
| M1 | Skill-evolution axis 0 falls back to overall | **Fixed** (unchanged) | Same `historyBandValue` nulls as UI H1. |
| M2 | History span can omit the first calendar day | **Fixed** (unchanged) | `rangeDays` inclusive calendar span was not reverted. |
| M3 | Plays today / 7 days / streak are UTC; streak starts at last play day | **Still open** (partial) | `practiceSnapshot.ts:14–31,52–74` still uses UTC day keys. Dashboard copy still says “Plays today (UTC)” etc. (`DashboardPage.tsx:160–168`). |
| M4 | Home weekly activity drops idle weeks, mixes keymodes, averages fails | **Still open** (partial) | Gap-fill in `getWeeklyActivity` is still in place (`progression.ts:68–93`). `statistics.ts:337–352` still does `accSum / playCount` (fails included) and is still all keymodes. |
| M5 | Failed plays still entered skill / Patterns / skillset mix | **Fixed** (unchanged) | Graded-only `streamManiaPass` not reverted. |
| M6 | Skillset mix counts plays, not maps | **Fixed** (unchanged) | Distinct `(beatmap, variant)` still used. |
| M7 | Accuracy-trend line interpolated across idle days | **Fixed** (unchanged) | `fillIdleAccuracyDays` + `connectNulls={false}` (`StatsPage.tsx:747`). |
| M8 | Comfort recency weight is inverted | **Still open** | `topRatedPlays` still sorts highest `reworkStar` first (`sevenKSkill.ts:261–272`). Weight is still `Math.pow(RECENCY_DECAY, total - i - 1)` (`sevenKSkill.ts:39,688`). Hardest of the top N still gets the smallest weight (~0.226 at N=30). |
| M9 | Grade X only at `total_score === 1_000_000` | **Still open** (**Low**) | `classifyScoreGrade` is unchanged (`scoreGrade.ts:2,19–23`): exact `1_000_000` → X, otherwise rank 6/7 → SS. Per the user, an unmodded lazer perfect is also 1,000,000, so the remaining risk is a perfect with a score multiplier below 1. Still unverified against live lazer totals. |
| M10 | Calendar click empty because list is capped at 100 | **Fixed** (perf trade-off UI-N1) | Unchanged. |
| M11 | Live / replay overlay ignored rate, EZ, HR, Classic | **Fixed** (unchanged) | `ScoreReplayModal.tsx:442,1419` still passes `toHitWindowOptions(parseScoreMods(...))`. Preview is still NM / unadjusted OD (acceptable for a NM preview). |
| M12 | `nomodOrMirrorOnlySql` vs `isNomodOrMirrorOnly` (Classic) | **Still open** | JS `STATS_ALLOWED_MODS` still allows `MR`+`CL` (`mods.ts:143–155`). SQL `DISALLOWED_MOD_ACRONYMS` still lists `CL` (`scoreGrade.ts:40–43`). |
| L1 | Monotone overshoot; weekly/home tooltips dump raw values | **Still open** (partial) | Skill / accuracy lines stay linear. Home and Stats weekly `<Tooltip>` still have no `formatter` (`DashboardPage.tsx:232–235`, `StatsPage.tsx:686–689`). Weekly datums still carry `totalPp` and 0–1 `avgAccuracy`. Whether Recharts 3.9 lists those extra fields in the default tooltip was **not runtime-verified** in this pass. Accuracy-trend tooltip is still formatted as percent. |
| L2 | Misses filters used `$.miss` only | **Fixed** (unchanged) | Bundled into H3. |
| L3 | Density downsample by index; categorical X | **Still open** | `downsampleDensitySamples` is still index-stride (`computePatternAnalysis.ts:160–171`). |
| L4 | Mastery blend is arbitrary and PP-starved | **Still open** | `analytics/mastery/formulas/simple.ts` `computeSimpleMastery` was not in the diff. |
| L5 | `formatPp` rounds to 0 decimals | **Still open** | `format.ts:17–19` still uses `toFixed(0)`. |
| L6 | Empty comfort axes inherit overall | **Fixed** (unchanged) | Not reverted. |
| L7 | Informational “no extra formula defects” | **n/a** | New residuals are filed as N3–N6 rather than stretching L7. |
| N1 | Classic convert maps never pass `convert: true` | **Still open** | `toHitWindowOptions` still has no `convert` field (`mods.ts:158–167`). Comment still says “Convert is not a mod.” Callers in `ScoreReplayModal.tsx:442` do not pass it either. |
| N2 | Stats weekly-activity bars still omit idle weeks | **Still open** | `getKeymodeProgression` still maps only weeks that exist in the bucket map (`playerStats.ts:844–851`). No calendar fill like `getWeeklyActivity`. |

---

## New issues

### N3 — First wheel tick (and Pause) while tosu is driving the clock can snap to lagging audio time

**Where.** `BeatmapPreviewEmbed.tsx` `holdAndFreeze` (`243–250`), `bindWheelSeek` `beforeSeek` (`252–265`), `mapTimeMs` / `seekTo` (`202–241`), `syncClockFromAudio` (`377–400`) and the `pause` listener (`415–417`). Live audio is only hard-resynced when drift exceeds `SYNC_RESYNC_MS = 2000` (`61,537–543`). `AudioClock.observe` while paused will adopt a sample more than `SEEK_SNAP_MS` (250 ms) away (`audioClock.ts:115–123`), and `set()` of the already-frozen time does **not** arm a seek lock (`audioClock.ts:63–66`).

**Root cause.** The new wheel path is:

1. `beforeSeek` sees a fresh tosu sample and calls `holdAndFreeze()`: clear the live sample, `clock.set(frozen, { playing: false })` (a rebase, so no seek lock), then `audio.pause()`.
2. If the element was playing, `pause` fires `syncClockFromAudio` **synchronously**. The live sample is already gone, so this function observes `audio.currentTime`. During live sync that time is allowed to be up to ~2 s away from the playfield clock.
3. Because there is no seek lock, the paused branch of `AudioClock` snaps to that audio time when the gap is greater than 250 ms.
4. The rAF flush then does `seekTo(mapTimeMs() + delta)`. `mapTimeMs` also goes through `sampleAudioClock` once the live sample is cleared, so the seek is applied to the **audio** position, not the frozen tosu time.

The same clobber exists on the Pause button (`togglePlay` → `holdAndFreeze` → `audio.pause()`). Wheel seek makes it much easier to hit.

**Impact.** Medium. On Now Selected, the first wheel notch while the preview is following osu! can jump the playfield by up to about two seconds, then add the 250 ms (or 5 s with Shift) seek on top of the wrong origin. That is exactly the “tosu must not move the preview after a hold” rule this commit documented in `knowledge/features/now-selected/index.md`. Subsequent notches are fine once `seekTo` has written `audio.currentTime`. Independent (non-live) preview is usually fine because audio and clock stay within 250 ms.

**Repro (source-reasoned; not captured in a browser here).** Open Now Selected on a matched map while tosu `beatmap.time.live` is flowing and the local audio has not been hard-resynced for a while (drift under 2 s is ignored). Wheel down once on the playfield. Expect the notes to move 250 ms from the on-screen time; a jump of several hundred milliseconds to two seconds plus 250 ms is the bug.

**Proposed patch.**

- In `syncClockFromAudio`, return immediately when `holdSyncRef.current` is true (same guard `tryAutoPlay` already uses).
- In `holdAndFreeze`, after freezing the clock, also assign `audio.currentTime = frozen / 1000` (with the existing `try/catch`) and set `desiredMsRef` / `seekGuardUntilRef`, so later observes cannot pull the clock backward.
- In the embed `seekBy`, seek from `clockRef.current.nowMs() + deltaMs` rather than from `mapTimeMs()`, which re-observes audio.
- Add a unit test around a small helper if you extract “frozen time + observe lagging paused sample must stay frozen.” A full React test is optional.

**Trade-offs.** Seeking the element on hold can briefly glitch local audio if it was playing in the background; that is acceptable because the hold already pauses it to avoid doubling game audio. Do not drop the “first wheel tick takes a hold” behaviour — that part is right.

**How to test.** Manual: Now Selected, live tosu, wheel once, confirm the clock moves one notch from the *visible* time. Pause during live sync must also keep the frozen time. Existing `AudioClock` pause tests stay green. Add a case: `set(frozen, { playing: false })` then `observe(frozen - 1500, { playing: false })` should **not** snap if a hold/seek lock is armed (this currently *does* snap, and is the engine-level half of the bug).

---

### N4 — `AudioClock` never corrects lag under 250 ms; seek lock can expire before a slow seek lands

**Where.** `apps/server/public/lib/audioClock.ts`: `SEEK_SNAP_MS = 250` (`17`), `SEEK_LOCK_MS = 400` (`21`), playing branch (`143–154`), paused branch (`115–123`). Tests in `audioClock.test.ts` cover the “do not rewind on a small lag” case and the 400 ms lock, and all 13 of those tests passed in this pass.

**Root cause.** To stop the playfield oscillating with the coarse `HTMLMediaElement.currentTime` (often 20–50 ms steps), a sample that is merely *behind* the interpolator is ignored unless the gap exceeds 250 ms. That is the right idea for one coarse tick. It is too loose for a lasting error:

- `performance.now()` and the media clock can drift. If the interpolator runs slightly fast, lagging samples are ignored forever until the gap exceeds 250 ms, at which point the playfield *jumps* backward.
- After `set()`, stale pre-seek samples are ignored for only 400 ms, and only while they are more than `SEEK_ARRIVE_MS` (50 ms) from the target. A seek that takes longer than 400 ms (large file, long jump, cold cache) can then be treated as a real discontinuity (`Math.abs(delta) > 250`) and snap back to the old time.

**Impact.** Medium for long previews and replays (a 4-minute map at 0.1 % drift is already ~240 ms, just under the snap threshold). Visible as a late playfield or a sudden 250 ms+ hitch. The seek-lock expiry is rarer but more jarring, and wheel seek / skip-5 s are now common ways to trigger large seeks.

**Repro.** Not measured here. Source-level: start the clock at 0, interpolate for several minutes with `observe` samples that stay 80–200 ms behind `nowMs()`; the clock never rebases. Separately, `set(t+60000)` then, at `now = 410`, `observe` of the pre-seek time — the lock has ended, so the clock can jump back.

**Proposed patch.**

- Treat lag inside one coarse tick (e.g. 0–60 ms) as “clock granularity” and ignore it, as today.
- Between that floor and 250 ms, *slew* toward the sample (a small blend, or rebase if lag stays above ~80 ms for several samples) so drift cannot accumulate to a 250 ms hitch.
- Always snap on a sample *ahead* of the interpolator (already done: `delta > 0`).
- Hold the seek lock until a sample lands within `SEEK_ARRIVE_MS` of the target, with a longer ceiling (1–2 s) instead of a flat 400 ms. The 400 ms value is also hard-coded as `seekGuardUntilRef` in the React layer; keep them in one shared constant.

**Trade-offs.** A more aggressive backward correction can re-introduce the jitter this commit removed. Keep the “ignore one coarse step” behaviour and add tests for both jitter and long-term lag. A longer seek lock can delay a *second* user seek’s raw samples; `set()` already replaces `seekTarget` / `seekLockUntil`, so a new `set()` should reset the lock (it already does).

**How to test.** Extend `audioClock.test.ts` (this file is standalone and was run successfully):

- Lag of 20 ms must not rewind (existing).
- Persistent lag of ~120 ms over several samples must correct, not sit there until 250 ms and jump.
- After `set()` to a far position, a stale sample at `now = 500` must still be ignored until a near-target sample arrives, or until a 1–2 s ceiling.

---

### N5 — Skill-evolution Y domain clips the extremes; focusing an empty band shows a blank chart

**Where.** `skillEvolutionDomain` / `domainFromValues` in `statsHelpers.ts:132–154`. Wired in `StatsPage.tsx:208–214,579–588,612–644`. Tests in `statsHelpers.test.ts` (all six new cases passed) describe the current contract: floor is the exact min, ceiling is the exact max, a flat series becomes `[min, min+1]`, and a focused band with no finite points falls back to the combined range.

**Root cause.** The knowledge doc asks for a Y axis that “starts at the lowest visible skill level.” The implementation uses that range with `allowDataOverflow={false}` and no padding, so the min and max strokes sit on the plot box and can be clipped. Separately, when the user isolates a band (`hide={focusBand != null && focusBand !== band}`), a band that is all `null` (possible after `historyBandValue` gaps) still *enters* focus. The domain then falls back to the other bands, but those lines are hidden — the chart is empty. The fallback is tested as a domain behaviour; the interaction with `hide` is not.

**Impact.** Low. Tight domain is mostly a visual issue (and a real improvement over a Y axis that starts at 0). The empty-focus path is a click/legend footgun on a sparse Rice/LN/FLN history.

**Repro.** Skill evolution with push/consistency around 4–6 and accuracy all gaps: click Accuracy in the legend. The accuracy line has nothing to draw; the other two disappear; the Y axis still shows 4–6.

**Proposed patch.**

- Pad the domain slightly (2–5 %, or a minimum of ~0.05) so the stroke is inside the plot, while keeping the floor near the lowest skill. Keep the flat-series `+1` rule.
- If the focused band has no finite points, do not enter focus (ignore the click) or clear focus instead of hiding the other lines. The combined-range fallback is only useful if those lines stay visible.

**Trade-offs.** A little padding means the axis labels are no longer exactly min/max; that is easier to read. Do not go back to a hard 0 floor — that was the problem this change fixed, and the new tests should stay.

**How to test.** Extend `skillEvolutionDomain` with a padded-domain case. Add a test (or a small `nextFocusBand(current, clicked, points)` helper) that a click on an all-null band does not isolate it. Manual: click each legend item on a history that has a gap on one axis.

**Note.** `LineDrawShape` + a 14 px transparent `Curve` is a valid Recharts 3.9 pattern for a fatter hit target. Whether clicks on that curve actually fire the `Line` `onClick` (once, not twice) was not checked in a browser. If isolation only works from the legend, attach the toggle to the transparent `Curve` as well.

---

### N6 — Wheel-seek copy is hardcoded; Now Selected has no hint; Firefox line-mode scale is assumed

**Where.**

- Hardcoded English in the shortcut hint: `BeatmapPreviewModal.tsx:1522` and `ScoreReplayModal.tsx:1797` (`wheel seek · shift 5s`). `SKIP_MS` is 5000 (`previewPrefs.ts:28`); the “5s” is a literal, not derived from `SKIP_MS`.
- `BeatmapPreviewEmbed` binds wheel seek on the playfield (`621–623`) but the control bar has no equivalent hint.
- `wheelSeekDeltaMs` treats `deltaMode === 1` as “one line = one notch” (`wheelSeek.ts:27–30`). The tests lock in `deltaY: 1` → 250 ms and `deltaY: -3` → 750 ms (`wheelSeek.test.ts:30–39`). Firefox has historically reported **3 lines per mouse notch**. That was not measured here.
- `bindWheelSeek` (ignore list, `allow`, `ctrlKey`/`metaKey`, rAF batching, `preventDefault`, cleanup) has no tests. `deltaMode === 2` (page) is also untested.

The rest of the helper is in good shape: RAF coalescing is the right way to handle a trackpad stream; `aside` correctly protects `ReplayAnalysisPanel` (which is an `<aside>` inside `stageEl`); `input` / `button` leave the scrubber and controls alone; Play mode is opted out in both modals; pinch-zoom (`ctrl`/`meta`) is not stolen.

**Impact.** Low. French/Spanish/Portuguese players see English in an otherwise translated shortcut line. Now Selected users can discover wheel seek only by accident (and then hit N3 if tosu is live). If Firefox still sends 3 lines per notch, one click seeks 750 ms instead of 250 ms.

**Repro.** Set the app language to fr, open beatmap preview, read the shortcut line. Open Now Selected: no wheel hint. Firefox mouse-wheel behaviour needs a real check.

**Proposed patch.**

- Add dictionary keys (all four locales) for the hint, and format the Shift step from `SKIP_MS` so the text cannot drift.
- Add a short hint on the embed control bar (Now Selected).
- For line mode, treat a typical notch as 3 lines if that is what Firefox still sends (or use `Math.sign(deltaY) * Math.min(|deltaY|, 1)` only if you have evidence one line is one notch). Measure once, then pin it in `wheelSeek.test.ts`.
- Add tests for page mode, `wheelSeekIgnoredTarget` (including a text-node target under a button, if you want to be defensive), and a fake-DOM test for `bindWheelSeek` (batching, `allow === false`, cleanup cancels rAF).

**Trade-offs.** Changing the Firefox scale will feel slower or faster for anyone already used to the current build; do it only after measuring. Do not add `div` or generic overflow containers to `WHEEL_SEEK_IGNORE`, or the playfield itself could be ignored.

**How to test.** i18n: switch to fr/es/pt and read both modal hints. Unit: extend `wheelSeek.test.ts`. Manual: wheel over the analysis aside (must scroll the list, not seek); wheel over the playfield (must seek); Shift-wheel equals the skip buttons; Ctrl-wheel still zooms the page.

---

## Still-open issues (unchanged since `a07a7f5`, line numbers updated)

Each item below is still present. The analysis is the same as the previous UI/logic reviews; only paths and lines were re-checked.

### UI-N1 — Sessions index loads every session (performance regression from the M6 fix)

**Where.** `apps/server/src/routes/sessions.ts:160` (`listSessions(db)` with no limit); `listSessions` in `analytics/session.ts:673–676`; UI `SessionsPage.tsx:30` (`fetchSessions(undefined, tzOffset)`); `public/lib/api.ts:323–332`. Day queries stay uncapped on purpose (`listSessionsOnUtcDay`, `routes/sessions.ts:152`).

**Root cause.** The cap that caused empty calendar clicks was removed from the *index* list as well as the day list.

**Impact.** Medium, and still the largest performance regression on this branch. A player with years of sessions gets an unbounded JSON payload and an unvirtualized list. Day clicks are correct.

**Repro.** Open Sessions with a large history; the index request has no `limit`.

**Proposed patch.** Restore a default cap (the old 100, or a “load more” page) on the index route only. Keep `listSessionsOnUtcDay` uncapped. Virtualize the list (`@tanstack/react-virtual` is already used on Download search).

**Trade-offs.** A cap without “load more” hides old sessions on the index; the calendar day drill-in still shows them.

**How to test.** Index with `limit` returns at most that many; `GET /api/sessions?day=` remains uncapped; a selected day with >100 sessions still lists all of them.

---

### L-M8 — “Recency” weight on comfort skill is inverted

**Where.** `apps/server/src/analytics/recommend/sevenKSkill.ts`: `topRatedPlays` sorts by `reworkStar` descending (`261–272`); comfort loop uses `Math.pow(RECENCY_DECAY, total - i - 1)` (`39,686–689`). `playedAt` is only a tie-breaker in the sort.

**Root cause.** Index 0 is the hardest of the top N, so it gets the *smallest* weight (~0.226 at N=30, `0.95^29`). The easiest of that window gets weight 1. If “recency” means recent in time, the sort should be by `playedAt`. If the name is wrong and the intent is “emphasize easier maps in the top 30,” the constant should not be called recency.

**Impact.** Medium. Comfort / recommendation skill is biased toward the weaker maps in the peak window.

**Repro.** Two otherwise equal maps in the top 30, one much older but slightly lower ★: the older, easier one is weighted more heavily.

**Proposed patch.** Sort a copy by `playedAt` (or weight by age directly) before applying `RECENCY_DECAY`. Leave the “top N by star” selection as it is. Add a regression test with two plays that differ only in `playedAt`.

**Trade-offs.** Changing the weight will move historical skill numbers and recommendations. Do it deliberately and snapshot a fixture.

**How to test.** Unit test: same star/accuracy, different `playedAt` → newer play has the larger recency weight.

---

### L-M9 — Display grade “X” only at `total_score === 1_000_000` (Low)

**Where.** `classifyScoreGrade` in `query-language/scoreGrade.ts:19–23` and the matching SQL `WHEN`. Unmodded perfects are 1,000,000 on both stable-style and lazer, per the user, so the common SS-vs-X path is correct.

**Root cause.** Any perfect whose stored total is not *exactly* 1,000,000 (a multiplier below 1: NF, EZ, HT) is graded SS from rank 6/7. Whether lazer actually stores those totals below 1,000,000 was not verified here.

**Impact.** Low. Only those modded perfects, and only if the realm total is not 1,000,000. Practice `grade:X` and the Stats rank bucket would disagree with a player who still calls that score an X.

**Proposed patch.** Do not change the unmodded path. If you want X for modded perfects, key off judgments (all MAX / 305-scale 100%) rather than the raw total, and only after checking real lazer rows.

**Trade-offs.** Using the total is simple and matches ScoreV1. A judgment-based rule needs a reliable perfect definition under mods.

**How to test.** Fixtures: 1,000,000 + rank 6 → X; 999,999 + rank 6 → SS (current); an NF perfect row from a real realm, once you have one.

---

### L-M4 — Home weekly activity still mixes keymodes and averages fails

**Where.** `getWeeklyActivity` in `progression.ts:68–93` (calendar fill is done). Accuracy still comes from `statistics.ts:337–352` (`accSum / playCount`). Home chart: `DashboardPage.tsx:205–237`.

**Root cause.** Gap-fill was fixed; the average still includes failed / ungraded plays, and the series is still all keymodes.

**Impact.** Medium for anyone who reads Home weekly accuracy as “how I scored this week.”

**Repro.** A week with one 99 % clear and one fail: the weekly accuracy is pulled down. 4K and 7K plays share a bar.

**Proposed patch.** Divide by a graded `accCount` (same as Stats). Optionally split or filter by keymode. Keep the 12-week zero fill.

**Trade-offs.** A keymode split is a larger UI change; fixing the fail-dilution is small and should match Stats.

**How to test.** A week with a fail and a clear: `avgAccuracy` equals the clear, not the mean of both.

---

### L-M3 — Snapshot “today / 7 days / streak” stay UTC; streak still starts at the last play day

**Where.** `practiceSnapshot.ts:14–31,52–74`. Dashboard labels honestly say UTC (`DashboardPage.tsx:160–168`).

**Root cause.** Buckets use UTC day keys. Streak counts backward from the last *play* day, so a rest day after a session already breaks the everyday meaning of “streak,” and a Europe/Lisbon evening play can fall on the next UTC day.

**Impact.** Medium for a player in Europe/Lisbon who treats “today” as local.

**Proposed patch.** Reuse the local-day helpers already used by the Sessions calendar (`tzOffset`, `localDayKey`). Start the streak at *today* (local): if there is no play today, the streak is 0.

**Trade-offs.** Historical dashboard numbers will shift at the timezone boundary. The UTC labels should go away only after the math is local.

**How to test.** A play at 23:30 Europe/Lisbon on a day with no later UTC plays counts as local today. No play today, plays yesterday → streak 0.

---

### L-M12 — `nomodOrMirrorOnlySql` disagrees with `isNomodOrMirrorOnly` on Classic

**Where.** JS allows `MR` and `CL` (`mods.ts:143–155`). SQL bans `CL` (`scoreGrade.ts:40–43,65`).

**Root cause.** Two filters, two policies. A Classic+Mirror score can be a JS nomod candidate and be excluded from SQL grade buckets (or the reverse, depending on the caller).

**Impact.** Medium for Stats rank distribution vs. in-memory skill candidates.

**Proposed patch.** Pick one policy (Classic-as-nomod is reasonable for lazer-default players who leave CL on) and share one allowed-mod list between JS and SQL.

**Trade-offs.** Including CL will change rank-bucket counts for Classic players.

**How to test.** A Mirror+Classic score is either accepted by both or rejected by both.

---

### UI-M7 — 1.6 MB `roxy.png` still bundled into share and video export

**Where.** `SessionShareCard.tsx:5`, `lib/replayVideoExport.ts:95`. Favicon / shell already use `icons/icon-192.png` (32,374 bytes).

**Impact.** Medium for first-load and for any share-image / video export that encodes the full PNG.

**Proposed patch.** Point both imports at `icon-192.png`, or a mid-size asset reserved for watermarking.

**How to test.** Bundle size / Network: no 1.6 MB `roxy.png` in the client graph. Share card and video still show a logo.

---

### UI-M8 / UI-L5 — Lists still not virtualized; Practice / Sessions / Collections still eager

**Where.** No `useVirtualizer` on Sessions or Practice list. `router.tsx:14,16,18` static imports. Chart animation on skill / density / accuracy is already off.

**Proposed patch.** Lazy-load those routes; virtualize Sessions (especially after UI-N1) and long Practice lists, following Download search.

---

### UI-M3 / L-L3 — Density chart X axis is still categorical; downsample is still by index

**Where.** `DensityOverTimeChart.tsx:72` (`dataKey="timeLabel"`). `computePatternAnalysis.ts:160–171` takes every `floor(i * step)`-th sample, so a peak between stride points can disappear.

**Proposed patch.** Numeric X in ms (format the tick as a clock). Downsample by max-NPS (or max chord) per bin, not by index.

---

### L-L1 — Weekly / Home tooltips still have no formatter

**Where.** `DashboardPage.tsx:232–235`, `StatsPage.tsx:686–689`. Datums still include `totalPp` and 0–1 `avgAccuracy`. Accuracy-trend tooltip is already formatted.

**Proposed patch.** A `formatter` that only presents `playCount` (and `formatAccuracy` if you keep accuracy). Whether Recharts 3.9’s default tooltip actually lists the extra fields was not checked in a browser this time; adding a formatter is still the safe fix.

---

### L-L4, L-L5, L-N1, L-N2, UI-N2, UI-L6, UI-L7 — remaining lows

- **L-L4.** `computeSimpleMastery` is still the practice-card sort key. Product decision; leave or replace deliberately.
- **L-L5.** `formatPp` still `toFixed(0)` (`format.ts:17–19`). Use one decimal (or two below 10 pp).
- **L-N1.** `toHitWindowOptions` still omits `convert`. Thread the beatmap convert flag from replay / live callers into `maniaHitWindows`. NM preview can stay as it is.
- **L-N2.** `getKeymodeProgression` weekly series still has no idle-week fill. Reuse the `getWeeklyActivity` calendar-week approach.
- **UI-N2.** First Stats paint still uses default 7K. Prefer `preferredKeyCount` on the server for the default source, or avoid fetching until it is known, so the first request is already the right keymode.
- **UI-L6.** Histogram still clamps into ±100 ms edge bins (`replayPatterns.ts:61,220–223`); column heat still ignores LN-tail misses (`268`). The analysis copy already warns about both. Widen the range or add overflow bins; count tails separately or include them with a distinct tint.
- **UI-L7.** Call sites of `formatMisses` / relative time that omit labels still get English. Pass `dict` at each site.
- **UI-L1 (residuals besides N6).** Set `lang` in `index.html` from the persisted locale if you already store it. Add the six `settings.onlineScorePull*` strings (and `session.loadMore` in es) to es/fr/pt — those gaps are unchanged since `a07a7f5`.

---

## Page notes (this commit)

| Page / surface | What `0d84595` changed | Remaining risk |
|----------------|------------------------|----------------|
| Stats skill evolution | Y domain from visible min–max; click / legend isolates a band; `LineDrawShape` hit target | N5 empty focus / clipping; L-M8 still feeds the series; UI-N2 first 7K fetch |
| Stats weekly / accuracy / mix | Unchanged math | L-N2 idle weeks; L-L1 weekly tooltip; accuracy trend is in good shape |
| Now Selected preview | Wheel seek + hold on first tick | **N3** live-sync snap; N4 clock drift; N6 no hint |
| Beatmap preview modal | Wheel seek (off in Play); English hint | N6 i18n; N4 |
| Score replay modal | Same wheel seek (off in Play); English hint | N6; L-N1 convert windows; UI-L6 histogram / heat |
| Settings → overlay | Monitor text field; 4-locale copy | Free-text only (no enumerated outputs) — overlay/desktop concern, not a logic bug |
| Sessions | Unchanged | UI-N1 unbounded index |
| Home | Unchanged | L-M3 / L-M4 / L-L1 |
| Practice list / profile | Unchanged | UI-L5 eager route; L-L4 mastery; UI-M3 density X |
| Router / shell | Unchanged | UI-L5; UI-M7 `roxy.png` in share/export only |

---

## Already in reasonably good shape (do not re-break)

- Checksum-guarded Now Selected live analysis.
- Skill-evolution `null` fallback (no overall line sneak-in) and the new min–max domain idea.
- Wheel-seek architecture: rAF batching, Play-mode `allow`, `aside` / form-control ignore list, Shift = skip buttons, `ctrl`/`meta` left for zoom.
- AudioClock resume-hold and “do not rewind on a single coarse tick” — the tests for those paths passed (13/13). Do not return to snapping every media sample.
- Practice search in the URL; calendar day query + `getCalendarActivity`; locale-matching weekday headers and `useLocalClock`.
- Default and Classic hit-window tables, rate scaling, EZ/HR adjust in `packages/mania-judge`.
- Shared judgement parser and `scoreMissCountSql`.
- Graded-only skill candidates; distinct skillset maps; accuracy-trend gap-fill + `connectNulls={false}`.
- Overlay output i18n keys in all four dictionaries, and `data.overlay.output` actually returned by `GET` settings (`routes/settings.ts:187–191`).
- Official lazer display accuracy remains 305-scale; stored accuracy is still 0–1 and the UI still multiplies by 100. Do not “fix” that.

---

## Limits of this re-review

This is a source diff against the `a07a7f5` UI and logic reviews, plus a close read of the new wheel-seek, audio-clock, skill-evolution, and overlay-settings UI. Unit tests listed above were executed; the full suite, a browser click-through, and a live tosu session were not. Overlay pixel corruption, Plasma monitor placement, and `apps/play-rune` are out of scope (see the parallel overlay / desktop reviews). N3 and N4’s real-world size should be confirmed on a playfield after the patches land.
