# Roxysu UI and domain logic — re-review of `play/rune-migration` at `aa5a12b`

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Branch reviewed:** `play/rune-migration`  
**Commit:** `aa5a12b457630b1fb751fc61d2be8c4331d0228e`  
(“Add overlay settings management and validation for the in-game overlay host”, 2026-11-23 00:54 Europe/Lisbon)  
**Compared against previous review at:** `0d845951ffb59bb1b1e8486927f5f965311510a2`  
**Commits in between:** 8 (UI/logic work is in `aa5a12b`; the other seven are overlay/desktop plus a knowledge-doc swap)  
**App version:** still `0.1.23` (`apps/server/package.json`)  
**Review date:** 2026-11-23 (Europe/Lisbon)  
**Worktree used:** `/workspace/rx-ui-logic-aa5a12b` (detached `HEAD` at the commit above; read-only; this document lives outside the repo)  
**Prior review:** `/workspace/Roxysu-ui-logic-review-0d84595.md`  
**User correction carried forward:** a lazer perfect score is also 1,000,000. Logic **L-M9** stays **Low**.

This is a source re-review of every item in the `0d84595` UI/logic review, plus a close pass over the new code in this range (mods, hit windows, grades, stats math, sessions caps, audio clock, wheel seek). Suggested patches match the existing TypeScript / React style. They are proposals only — nothing in the repo was modified or pushed (a local `bun install` was used only to run tests).

Line numbers refer to `aa5a12b`.

---

## Summary table (still-open, partial, and residual)

| ID | Area | Sev. | Title | Status at `aa5a12b` |
|----|------|------|-------|---------------------|
| **UI-N2** | Stats | **Medium** | First Stats visit still fetches 7K: the client omits `keyCount` and `getPlayerStats` would use `preferredKeyCount`, but `GET /api/stats` calls `parseSkillKeyCount(undefined)` → 7 first | **Still open** (attempted; broken at the route) |
| **UI-N1** | Sessions | **Medium** | Index list is capped again (good), but the calendar *day* query is now capped at 100 with no day-level “Show all” | **Partly fixed** (perf fixed; day-list residual of M6) |
| L-M4 | Home | Medium | Weekly accuracy no longer averages fails; the series is still all keymodes; stored partitions need a statistics rebuild | **Partly fixed** |
| UI-M8 | Lists / charts | Low–Med | Practice / Sessions / Collections still not virtualized (less urgent now that Sessions is capped) | Still open (partial) |
| UI-M3 / L-L3 | Density | Medium / Low | Density X axis is still categorical; downsample is still index-stride | Still open |
| L-M9 | Grades | Low | Display grade “X” only at exactly 1,000,000 (only modded perfects affected) | Still open (Low; tests now pin this) |
| UI-L5 | Router | Low | Practice, Sessions, and Collections are still eager in the main bundle | Still open |
| UI-L6 | Replay analysis | Low | Histogram still clamps ±100 ms; column heat still ignores LN-tail misses | Still open |
| L-L4 | Practice mastery | Low | Mastery blend unchanged | Still open |
| UI-L7 | Miss / relative time | Low | `formatMisses` / relative time still English when callers omit labels | Still open (partial) |
| L-N2 | Stats weekly | Low | Idle weeks between first and last played week are now filled; the series still ends at the last *played* week, so a current idle week is omitted | **Fixed** (small residual) |

**Fixed in this range (do not re-break):** N3, N4, N5, N6, L-M8, L-M3, L-M12, UI-M7, L-N1, L-L1, L-L5, UI-L1.

---

## Recommended fix order

1. **UI-N2** — stop `GET /api/stats` from coercing a missing `keyCount` to 7, so `getPlayerStats`’s new `preferredKeyCount` path can actually run. Cache the payload under the *resolved* key. This is the attempted fix that does not work yet.
2. **UI-N1 residual** — keep the index cap (100, max 500), but do not apply the default 100 to `?day=` (or pass `limit=500` / a day-level “Show all” from `SessionsPage`). Calendar clicks must not hide sessions again.
3. **L-M4 residual** — optionally split or filter Home weekly activity by keymode; run a full `runStatisticsEngine` so stored `daily_stats` / `weekly_stats` / `mapper_stats` pick up `accCount`.
4. Density X axis + peak-preserving downsample (UI-M3 / L-L3).
5. Remaining lows: eager routes, histogram / LN-tail heat, mastery, `formatMisses` call sites, L-M9 (only if you want X for modded perfects — verify against real lazer rows first).

---

## What this range changed (UI / logic)

All of the product UI/logic work landed in `aa5a12b` (the commit message is overlay-settings-heavy; the diff is not). Relative to `0d84595`:

- **N3 / N4** — `holdAndFreeze` rebases `audio.currentTime` to the frozen clock, `syncClockFromAudio` bails during a paused live-sync hold, and embed seeks use `clock.nowMs()` rather than `mapTimeMs()`. `AudioClock` slews persistent lag (`COARSE_TICK_MS = 60`, `LAG_SLEW = 0.25`), holds a seek lock until a sample arrives near the target with a `SEEK_LOCK_MAX_MS = 1500` ceiling (shared with the React guards), and arms a short lock on pause-freeze.
- **N5 / N6** — skill-evolution domain is padded; `nextSkillFocus` refuses an all-null band. Wheel hint is `common.wheelSeekHint` (all four locales, `{{seconds}}` from `SKIP_MS`); Now Selected shows it; Firefox line mode is 3 lines per notch; `bindWheelSeek` has DOM-stand-in tests.
- **UI-N1** — `DEFAULT_SESSION_LIST_LIMIT = 100`, `MAX_SESSION_LIST_LIMIT = 500`. Index, day, command palette, and “Show all” all go through a cap. Day queries are no longer unbounded.
- **UI-N2 (attempted)** — Stats page omits `keyCount` on a default first visit; `getPlayerStats` would fall back to `preferredKeyCount`. The HTTP route still parses the omitted param as 7 (see below).
- **L-M3** — Home snapshot uses `getCalendarActivity` + `localDayKey` / `tzOffset`; streak is anchored at *today*; dashboard labels dropped “(UTC)”.
- **L-M4 / mapper accuracy** — `statistics.ts` and `mapperUsername.ts` add `accCount` and only add accuracy for `rank !== -1`.
- **L-M8** — comfort recency sorts the top-N window by `playedAt` (newest first) and uses `Math.pow(RECENCY_DECAY, i)`. Regression test added.
- **L-M12** — `CL` removed from `DISALLOWED_MOD_ACRONYMS`; JS/SQL policy test added.
- **L-N1** — `toHitWindowOptions(mods, { convert })`; `ScoreReplayModal` threads convert when `score.rulesetShortName === "mania"` and the beatmap is not mania. Pin test in `windows.test.ts`.
- **L-N2** — `fillIdleWeeks` inserts zero weeks between the first and last played week.
- **L-L1 / L-L5 / UI-M7 / UI-L1** — weekly tooltips got a `playCount` formatter; `formatPp` uses 2 decimals below 10 pp and 1 otherwise; share card and replay video export use `icons/icon-192.png`; `index.html` sets `lang` from `localStorage` `roxysu:language` before paint; es/fr/pt are now in key-parity with en (including the earlier `onlineScorePull*` / `session.loadMore` gaps, plus `wheelSeekHint` and overlay restart copy).
- **Settings** — “Restart overlay” button (`overlayRestartHost`), four-locale copy. Out of scope except i18n.

---

## What was and was not verified

**Verified in source at `aa5a12b`:** every status mark below was re-read in the files cited. i18n key sets are equal across en/es/fr/pt (1,466 keys each). Asset imports for share/export were grepped.

**Tests actually run** (after a local `bun install --frozen-lockfile`; **79 pass, 0 fail**, 193 assertions):

- `apps/server/public/lib/audioClock.test.ts` — 17 pass (including slew, slow-seek ceiling, pause-freeze)
- `apps/server/public/components/wheelSeek.test.ts` — 10 pass (including `bindWheelSeek` coalescing, ignore list, ctrl/meta)
- `apps/server/public/features/stats/statsHelpers.test.ts` — 12 pass (padded domain, `nextSkillFocus`)
- `apps/server/src/analytics/recommend/sevenKSkill.test.ts` — 13 pass (including recency-by-time)
- `packages/mania-judge/src/windows.test.ts` — 8 pass (including convert threading)
- `apps/server/src/query-language/grade.integration.test.ts` — 7 pass (including Classic+Mirror nomod agreement)
- `apps/server/src/routes/sessions.list.test.ts` / `sessions.test.ts` — 12 pass (list caps)

The full monorepo suite was not run. The UI was not driven in a browser or against a live tosu session, replay file, or player database. Whether stored `daily_stats` rows have been rebuilt with `accCount` was not checked on a real database.

---

## Status of the `0d84595` findings

### Fixed

| ID | Evidence at `aa5a12b` |
|----|------------------------|
| **N3** | `BeatmapPreviewEmbed.tsx`: `holdAndFreeze` writes `desiredMsRef`, a `SEEK_LOCK_MAX_MS` guard, and `audio.currentTime = frozen / 1000` before `pause()` (`249–269`); `syncClockFromAudio` returns when `holdSyncRef.current && audio.paused` (`394–397`); `seekBy` / ±5 s use `clockRef.current.nowMs()` (`238–246`, `749–757`). `AudioClock.set` arms a short lock on a pause-freeze even when the position is a rebase (`90–97`). Pause-freeze tests passed. |
| **N4** | `audioClock.ts`: `SEEK_LOCK_MAX_MS = 1500` (`37`, exported and used by the React guards); lock held until a sample is within `SEEK_ARRIVE_MS`, then 400 ms grace (`146–150`); lag between 60 ms and 250 ms is slewed at 25% per sample (`46–48`, `192–198`). Slew and slow-seek tests passed. After the 1.5 s ceiling with no arrival, a stale sample can still snap — that ceiling is the intended contract, pinned by test. |
| **N5** | `domainFromValues` pads 5% (min 0.05) and never goes below 0 (`statsHelpers.ts:132–143`). `nextSkillFocus` ignores a band with no finite points (`152–159`, `StatsPage.tsx:229–232`). New tests passed. |
| **N6** | `common.wheelSeekHint` in all four dictionaries, used with `{ seconds: SKIP_MS / 1000 }` in the embed (`BeatmapPreviewEmbed.tsx:761–763`), preview modal, and replay modal. `LINES_PER_NOTCH = 3` (`wheelSeek.ts:6,30`). Page mode and `bindWheelSeek` tests passed. (If `dict` is still loading, `t(undefined)` returns `""` — a blank hint for one frame, not a hardcoded English leak.) |
| **L-M8** | `sevenKSkill.ts:680–700`: copy of the top-N window sorted by `playedAt` descending; weight is `Math.pow(RECENCY_DECAY, i)` (newest = 1). Test “recent plays weigh more than old ones, not hardest-first” passed (`≈5.5256175` vs the pre-fix `≈5.4744`). |
| **L-M3** | `practiceSnapshot.ts`: `localDayKey` + `getCalendarActivity(..., tzOffsetMinutes)`; streak walks backward from *today* and stops on the first idle day (`22–34`, `61–77`). `DashboardPage.tsx` fetches `fetchDashboard(tzOffset)` keyed on `todayKey`, and the labels are “Plays today” / “Last 7 days” / “Active-day streak” (dictionaries updated, no “UTC”). `tzOffset === 0` still reads UTC `daily_stats` via `getCalendarActivity` — correct for Europe/Lisbon in winter; summer uses the score-recount path. |
| **L-M12** | `CL` is no longer in `DISALLOWED_MOD_ACRONYMS` (`scoreGrade.ts:39–47`). `STATS_ALLOWED_MODS` is still `{MR, CL}`. Integration test “Classic + Mirror scores count as nomod” and “SQL disallowed mods and JS allowed mods stay disjoint” passed. |
| **UI-M7** | `SessionShareCard.tsx` and `lib/replayVideoExport.ts` now import `icons/icon-192.png`. No product-UI `import` of `roxy.png` remains. `apps/server/scripts/build-ui.ts` still *copies* `roxy.png` into the static output as a leftover asset list entry; docs / tosu-counter still reference it. That is no longer in the share/export JS graph. |
| **L-N1** | `toHitWindowOptions(mods, { convert })` (`packages/mania-judge/src/mods.ts:163–175`). `ScoreReplayModal.convertedChart` is `score.rulesetShortName === "mania" && beatmap.rulesetShortName !== "mania"` (`437–444`), passed into live play and the notefield windows (`452–454`, `1431–1433`). `windows.test.ts` threads convert and passed. Residual: `simulate.ts` and NM preview (`maniaHitWindows(od)` only) still omit convert — acceptable for a NM preview, as before. |
| **L-N2** | `fillIdleWeeks` in `playerStats.ts:844–891` inserts zero-play Monday weeks between the first and last played week. Residual: unlike Home’s last-12-calendar-weeks fill, the Stats series does not extend through the current idle week. |
| **L-L1** | Home and Stats weekly tooltips now have a `formatter` that shows localized `playCount` only (`DashboardPage.tsx:234–237`, `StatsPage.tsx:702–708`). |
| **L-L5** | `format.ts:17–20`: `${value < 10 ? value.toFixed(2) : value.toFixed(1)}pp`. |
| **UI-L1** | `index.html` sets `document.documentElement.lang` from `localStorage` `"roxysu:language"` before paint when the value is `en`/`es`/`fr`/`pt`. en/es/fr/pt dictionaries are in key-parity (1,466 keys), including the previously missing `settings.onlineScorePull*` and `session.loadMore`. English `??` fallbacks remain as the existing pattern. |

### Partly fixed or still open

The detailed write-ups follow.

---

## Still-open and partial issues (in-depth)

### UI-N2 — First Stats visit still fetches 7K: the route undoes the new preferred-key path

**Where.**

- Client (intent is right): `StatsPage.tsx:160–178` omits `keyCount` while `statsKeyCountSource() === "default"` and the correction effect has not run; `fetchStats` passes `keyCount: params?.keyCount` (`api.ts:109–123`).
- Engine (intent is right): `getPlayerStats` (`playerStats.ts:929–934`) does `parseSkillKeyCount(query.keyCount ?? preferredKeyCount ?? DEFAULT_SKILL_KEY_COUNT)`.
- Route (this is the hole): `apps/server/src/routes/stats.ts:114–132`:

```ts
const keyCount = parseSkillKeyCount(query.keyCount);
// ...
const payload = await buildStatsResponse(db, { granularity, skillTopPlays, keyCount });
```

`parseSkillKeyCount(undefined)` returns `DEFAULT_SKILL_KEY_COUNT` (7) (`sevenKSkill.ts:106,189–191`). `buildStatsResponse` then passes `keyCount: 7` into `getPlayerStats`, so `query.keyCount` is 7 and the `preferredKeyCount` fallback never runs. The cache key is also stored under 7.

**Root cause.** The defaulting lives in two layers. The route applies the old “missing means 7” helper *before* the function that was changed to treat missing as “use the preferred key.”

**Impact.** Medium. A 4K (or 6K/8K/…) main can still see a first Stats payload for 7K, then a jump when `preferredKeyCount` arrives and the effect writes the URL/storage. The jump the last review asked to remove is still there. There is no test that `GET /api/stats` without `keyCount` returns the preferred keymode.

**Repro (source-reasoned).** New profile, no `roxysu:skill-key-count`, no `?keyCount=` in the hash, preferred key 4. Open Stats. The first request is `/api/stats` with no `keyCount`; the handler still builds 7K stats.

**Proposed patch.**

- In the route, leave an omitted/empty `keyCount` as `undefined` and pass that through to `getPlayerStats`. Only call `parseSkillKeyCount` when the client sent a value.
- Resolve the key inside `getPlayerStats` (already done) and key the cache on the *resolved* `keyCount` from the payload, not on the pre-defaulted 7.
- Optional: have `getPlayerStats` return the resolved `keyCount` explicitly so the page can adopt it without a second guess.
- Add a route/integration test: preferred 4, omit `keyCount`, payload is 4K (and `preferredKeyCount === 4`).

**Trade-offs.** Other callers of `parseSkillKeyCount` (e.g. `/stats/skill-plays`) still default to 7 when omitted — decide whether that endpoint should follow the same “preferred when missing” rule. After the route is fixed, the toggle/title can still say 7K for a moment until the effect writes `preferredKeyCount`; that is a chrome mismatch, not a wrong first payload.

**How to test.** The integration test above is the one that would have caught this. Manual: wipe `roxysu:skill-key-count`, open Stats as a non-7K main, confirm the first network response is already that keymode.

---

### UI-N1 — Sessions index is capped again, but the day query is too

**Where.** `DEFAULT_SESSION_LIST_LIMIT = 100`, `MAX_SESSION_LIST_LIMIT = 500`, `clampSessionListLimit` (`routes/sessions.ts`). Both branches of `GET /api/sessions` now pass a limit (`163–175`), including `listSessionsOnUtcDay(db, day, limit, tzOffset)`. `SessionsPage.tsx:31–44`: the index default uses the server default (100); “Show all” fetches 500 (`SHOW_ALL_LIMIT`) only when `selectedDay == null`. A selected day’s query is `fetchSessions(selectedDay, tzOffset)` with **no** explicit limit, so it is also 100. The “Show all” control is hidden while a day is selected (`hasMoreWithoutFilter = !selectedDay && …`). Command palette correctly asks for 100 (`CommandPalette.tsx`). List-cap tests passed, including “`?day=` respects the default cap”.

**Root cause.** The unbounded index (the performance regression) was fixed by capping *every* list path, including the day drill-in that had been left uncapped on purpose so calendar clicks could not hide sessions (old M6).

**Impact.** Medium as a residual, not as the original perf bug. The index is safe again. A calendar day with more than 100 sessions will silently drop the oldest, and the UI has no way to raise that cap. 100 sessions in one local day is uncommon but not impossible (short “sessions,” a long stream, a bad split). The hard max of 500 also applies to `?day=` even if the client later sends a larger limit.

**Repro.** Seed 150 sessions on one local day (the list test already seeds more than 100 on a single UTC day). Open Sessions, click that day: 100 items, no “Show all.”

**Proposed patch.**

- Keep the default 100 (and max 500) on the *index* list.
- For `?day=`, either omit the cap (the old contract) or default to `MAX_SESSION_LIST_LIMIT` and add a day-level “Show all” / “has more” if you really need a cap.
- `SessionsPage` should pass `SHOW_ALL_LIMIT` for the day query, or show “Show all” while a day is selected.
- Virtualization is still worth doing if “Show all” can return 500 rows (UI-M8).

**Trade-offs.** An uncapped day query is fine at typical sizes; a 500 cap with a visible “has more” is a reasonable compromise. Do not drop the index cap.

**How to test.** Extend `sessions.list.test.ts`: index with no query stays at 100; `?day=` with 150 sessions returns all 150 (or 500 with a `hasMore` flag, if you go that way). Click a busy day in the UI and confirm the list matches the calendar count.

---

### L-M4 — Home weekly accuracy no longer includes fails; keymodes still mixed

**Where.** `statistics.ts` `bump` now takes `graded` and only adds to `accSum` / `accCount` when `rank !== -1` (`48–70`, `157–159`, `360–370`). `mapperUsername.bumpMapperAgg` does the same. `getWeeklyActivity` still reads those weekly rows with no keymode filter (`progression.ts:68`, `dashboard.ts:98`: `getWeeklyActivity(db, 12)`). Home weekly tooltip now formats `playCount` only (L-L1 fixed).

**Root cause.** The fail-dilution half is fixed in the engine. The series is still all keymodes in one bar. Existing `daily_stats` / `weekly_stats` / `mapper_stats` rows were written with the old `accSum / playCount` formula; they stay stale until `runStatisticsEngine` rebuilds them (full run in the analytics pipeline, or a delta rebuild for new scores only — old days may not be rewritten).

**Impact.** Medium until a full rebuild; after that, low–medium (mixed keymodes only).

**Repro.** After a rebuild: a week with a 99% clear and a fail should show 99%, not a blend. 4K and 7K plays still share a bar. Before a rebuild, the stored weekly accuracy can still be the old blended number.

**Proposed patch.** Trigger (or document) a one-shot full statistics rebuild on upgrade. Optionally add a keymode filter or split, like Stats.

**Trade-offs.** A keymode split is a larger UI change; the rebuild is required for the accuracy fix to show up on Home.

**How to test.** Engine unit test: fail + clear in one week → `avgAccuracy` equals the clear. After deploy, inspect a known week on Home vs Stats.

---

### UI-M8 / UI-L5 — Lists still not virtualized; Practice / Sessions / Collections still eager

**Where.** No `useVirtualizer` on Sessions or the Practice list. `router.tsx:14,16,18` still statically import those pages. Chart animation on skill / density / accuracy was already off.

**Impact.** Lower than at `0d84595` because the Sessions index is capped at 100 (500 with “Show all”). The main bundle still pays for those routes on first load.

**Proposed patch.** Lazy-load the three routes; virtualize the Sessions list when “Show all” can return 500 rows, and long Practice lists, following Download search.

---

### UI-M3 / L-L3 — Density chart X axis is still categorical; downsample is still by index

**Where.** Unchanged: `DensityOverTimeChart.tsx:72` `dataKey="timeLabel"`; `computePatternAnalysis.ts:160–171` still takes every `floor(i * step)`-th sample.

**Proposed patch.** Numeric X in ms (format the tick as a clock). Downsample by max-NPS (or max chord) per bin, not by index.

---

### L-M9 — Display grade “X” only at `total_score === 1_000_000` (Low)

**Where.** `classifyScoreGrade` is unchanged (`scoreGrade.ts:19–25`). New tests explicitly pin the current rule: “1M is X, not SS,” “rank X below 1M is SS,” “grade:X matches only 1,000,000 scores” — all passed.

**Root cause / impact.** Unchanged. An unmodded lazer perfect is 1,000,000 (user correction). Remaining risk is a perfect with a score multiplier below 1 (NF/EZ/HT) if the stored total is not exactly 1,000,000. Still unverified against live lazer totals.

**Proposed patch.** Do not change the unmodded path. If you want X for modded perfects, key off judgments after checking real realm rows.

---

### UI-L6, L-L4, UI-L7 — remaining lows, unchanged

- **UI-L6.** `HIST_HALF_RANGE = 100` (`replayPatterns.ts:61,220–223`); `computeColumnHeat` still skips tail misses (`isTail`). The panel copy already warns. Widen the range or add overflow bins; count tails separately or include them with a distinct tint.
- **L-L4.** `computeSimpleMastery` was not in the diff. Product decision.
- **UI-L7.** `formatMisses` still defaults to `"FC"` / `"1 miss"` / `"N misses"` when labels are omitted (`format.ts:28–37`). Pass `dict` at each remaining call site.

---

## Previously fixed items (re-checked, not reverted)

UI H1/H2, M4 (aside from UI-N2), M5, M6’s empty-click calendar path (activity still comes from `getCalendarActivity`; the new risk is only the day *list* cap), M9 calendar week start, L2 hints, L3 router errors, L4 `useLocalClock`. Logic H1–H3, M1, M2, M5–M7, M10, M11, L2, L6. `historyBandValue` still returns `null` on a zero axis. Live analysis is still checksum-guarded. Hit windows still match the lazer tables in `windows.test.ts`.

---

## New-code notes (not separate IDs)

- **Stale Home accuracy** until a full statistics rebuild — see L-M4.
- **Stats weekly trailing idle week** — see L-N2 residual.
- **`t(undefined)`** on the wheel hint before the dictionary loads renders an empty string, not the English fallback. Harmless if `useAppDict` is ready on those pages; add `?? \`wheel seek · shift ${SKIP_MS / 1000}s\`` if you want a first-paint string.
- **Overlay restart** button and URL/output validation are desktop/settings concerns; the four-locale copy is complete.
- **`convert` on `simulate.ts`** is still omitted. Only matters if that helper is used on Classic convert maps.

No new mania formula defect was found in the changed grade / window / accuracy / recency code beyond the route-layer UI-N2 hole and the day-list cap.

---

## Page notes (this range)

| Page / surface | What `aa5a12b` changed | Remaining risk |
|----------------|------------------------|----------------|
| Now Selected preview | N3/N4 clock + hold; wheel hint | UI not runtime-verified against live tosu |
| Preview / replay modals | i18n wheel hint; replay convert windows; shared seek-lock constant | NM preview still unadjusted OD |
| Stats skill evolution | Padded domain; empty focus ignored; first request *tries* to omit keyCount | **UI-N2** route still forces 7K; L-N2 trailing week |
| Stats weekly / accuracy | Idle-week fill; weekly tooltip formatter | Trailing idle week; keymode is on the payload once UI-N2 is fixed |
| Home | Local-day snapshot + streak; accuracy engine uses `accCount`; tooltip formatter | L-M4 keymodes + stale partitions; weekly bars still UTC weeks |
| Sessions | Capped index + “Show all” (500); palette cap | **UI-N1** day list also capped at 100; no virtualization |
| Share / video export | `icon-192.png` | `build-ui.ts` still copies `roxy.png` as a static file |
| Settings overlay | Restart button + i18n | — |
| Router / practice list | Unchanged | UI-L5 / L-L4 |

---

## Already in reasonably good shape (do not re-break)

- Live-sync hold: rebase the element, ignore paused observes, seek from `clock.nowMs()`.
- AudioClock slew + arrival-based seek lock + shared `SEEK_LOCK_MAX_MS`. The new tests are the contract — keep them green.
- Recency-by-`playedAt` (not hardest-first).
- `accCount` gate for weekly/daily/mapper accuracy.
- Local-day Home snapshot and today-anchored streak.
- JS/SQL Classic-as-nomod agreement.
- Convert flag threaded from beatmap mode, not from a fake mod.
- Skill-evolution padding and `nextSkillFocus`.
- Wheel-seek i18n, 3-line Firefox notch, rAF batching, Play-mode `allow`, `aside` ignore list.
- Sessions *index* default cap of 100 (restore of the pre-regression behaviour).
- Four-locale key parity and the pre-paint `lang` script.
- Official lazer display accuracy remains 305-scale; stored accuracy is still 0–1 and the UI still multiplies by 100. Do not “fix” that.
- Unmodded perfect = 1,000,000 = grade X on both lazer and stable-style totals.

---

## Limits of this re-review

This is a source diff against the `0d84595` UI/logic review, plus the tests listed above. It is not a click-through of the Electron shell, not a live tosu session, and not an audit of an existing player database (so stale `daily_stats` rows were not inspected). Overlay pixel / Plasma behaviour is out of scope (see the parallel overlay and desktop reviews).
