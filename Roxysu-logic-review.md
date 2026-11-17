# Roxysu UI & domain logic — in-depth page-by-page analysis

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Default branch reviewed:** `master`  
**Commit:** `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`  
(“Update the docs site download links to v0.1.23.”, 2026-11-03 16:34 Europe/Lisbon)  
**App version:** `0.1.23`  
**Review date:** 2026-11-17 (Europe/Lisbon)  
**Clone used:** `/workspace/Roxysu` (read-only; this document lives outside the repo)  
**Companion review:** `/workspace/Roxysu-desktop-review.md` covers the Electron shell only. This document is the product UI and the mania analysis logic behind it.

This is a logic review of every hash route in `apps/server/public/router.tsx`. Each page is traced UI → API (`apps/server/src/routes`) → computation / Realm-backed SQLite. The bar is: would this mislead an osu!mania player about accuracy, PP, stars, skill, sessions, or a graph? Suggested patches match the existing TypeScript style. They are proposals only — nothing in the repo was modified or pushed.

Issue IDs are unique to this document (H1–H3, M1–M12, L1–L7). They are not the desktop-shell IDs.

---

## What was and was not verified

**Verified in source (this commit):** every issue below was re-read in the files cited. Small Node probes were run on the review machine for the numeric examples (hit windows, 305 vs 300 accuracy, weekly-average denominator, recency weights, `rangeDays`). Official lazer hit-window source was fetched from [ppy/osu `ManiaHitWindows.cs` (master)](https://raw.githubusercontent.com/ppy/osu/master/osu.Game.Rulesets.Mania/Scoring/ManiaHitWindows.cs) on 2026-11-17.

**Not verified (do not treat these as runtime measurements):**

- The packaged app, a live lazer `client.realm`, and real player databases were not opened. Accuracy scale (0–1) and `statistics` JSON casing are inferred from the mapper, tests, and `writeOnlineScores` style detection, not from a production Realm dump.
- Lazer `Score.TotalScore` / standardised vs Classic 1,000,000 ceilings were not observed on a live client. The “X = exactly 1,000,000” rule is a source finding; whether modern lazer-native scores ever hit that exact value is marked unverified.
- Companella’s original 0.95 decay convention was not re-read in Companella source. The inversion claim is based on this repo’s own sort order (highest ★ first) plus the usual “index 0 = full weight” convention; it is called out as such.
- Charts were not screenshot-tested in a browser. Tooltip payload behaviour follows Recharts’ default (`Tooltip` with no custom `formatter` lists every key on the data object).
- Rating Lab, Hub admin, overlay editor, and skin editor were reviewed for domain-formula risk only, not as full product audits.
- Existing repo findings under `findings/` marked `status: fixed` (F-003, F-015, F-016, F-043, F-064, …) were checked as already addressed in this commit and are not re-opened.

**Intentional behaviour already documented in-tree** (not filed as new bugs, but players can still trip on them):

- Stats volume charts include every mod. Skill / Patterns / skillset mix use dan-variant stars when a variant exists, otherwise drop the modded play (`knowledge/features/stats/index.md`, “Mod gate”).
- Stats accuracy averages exclude ungraded (failed / quit, `rank === -1`) plays. Dashboard `daily_stats` / `weekly_stats` do **not** — the knowledge doc already calls this “an open follow-up”. This review still files it because the Home tooltip and “Plays today” surface that engine to players.
- Hour and weekday charts are honestly labelled “(UTC)”. Daily/weekly keys and “Plays today” are also UTC but are **not** labelled that way on Home.

---

## Summary table

| ID | Page | Severity | Title | Primary file | Effort |
|----|------|----------|-------|--------------|--------|
| H1 | Replay / live practice / timing overlay (Practice profile, Session detail, Now selected, preview) | High | Hit windows do not match lazer: miss is 10 ms too tight, MAX is a fixed 16 ms, rate=1 skips the `+ 0.5` | `packages/mania-judge/src/windows.ts`, `mods.ts` | Medium (port `ManiaHitWindows`, then plumb Classic vs default + rate/EZ/HR) |
| H2 | Stats, Home | High | Weekly `avgAccuracy` divides by `playCount` (fails included) instead of `accCount`; default chart tooltips expose the wrong number | `apps/server/src/analytics/playerStats.ts` `getKeymodeProgression` | Small (1–2 h) + tooltip formatters |
| H3 | Session detail, Practice profile, Practice search (`misses:`) | High | Judgment JSON is only read with lowercase keys; lazer commonly stores `Perfect` / `Miss` or integer enums | `apps/server/src/scores/parseStatistics.ts`, `query-language/compile.ts`, `packages/db/src/bmsInterpret.ts` | Small–medium (shared parser + tests against all three styles) |
| M1 | Stats (skill evolution) | Medium | Rice / LN / FLN history falls back to the overall line whenever the axis value is 0 | `apps/server/public/features/stats/statsHelpers.ts` `historyBandValue` | Small |
| M2 | Stats (skill evolution) | Medium | History span uses elapsed milliseconds, so the calendar day of the first play can be omitted | `apps/server/src/analytics/playerStats.ts`, `sevenKSkill.ts` `buildSampleKeys` | Small |
| M3 | Home | Medium | “Plays today”, “Last 7 days”, and “Active-day streak” are UTC and the streak starts at the last play day, not today | `apps/server/src/analytics/practiceSnapshot.ts` | Small–medium (label or local timezone + streak policy) |
| M4 | Home | Medium | Weekly activity is the last 12 *weeks that have plays* (gaps dropped, all keymodes), from an engine that also averages fails into accuracy | `apps/server/src/analytics/progression.ts`, `statistics.ts`, `DashboardPage.tsx` | Medium |
| M5 | Stats, recommendations | Medium | Failed / quit plays are excluded from accuracy averages but still enter skill, Patterns, and skillset mix | `apps/server/src/analytics/playerStats.ts` `streamManiaPass` | Small |
| M6 | Stats (skillset mix) | Medium | The Rice / LN / FLN bar chart counts plays, not maps, so retries skew the mix | `apps/server/src/analytics/playerStats.ts` `getSkillsetMix` | Small |
| M7 | Stats (accuracy trend) | Medium | The line chart connects only days that have plays, so idle gaps look like smooth interpolation | `StatsPage.tsx`, `getKeymodeProgression` | Small–medium (gap-fill nulls, `connectNulls={false}`) |
| M8 | Stats, Practice recommendations | Medium | “Recency” weight on comfort skill is inverted relative to a highest-★-first list (`0.95^(n-1-i)` gives the weakest of the top N the most weight) | `sevenKSkill.ts` | Small, but needs a recommendation regression test |
| M9 | Stats (rank distribution), Practice query `grade:X` | Medium | Display grade “X” is only awarded at `total_score === 1_000_000`; lazer-native scores may never land in that bucket | `apps/server/src/query-language/scoreGrade.ts` | Medium (define X from judgments or maximum statistics; unverified on live scores) |
| M10 | Sessions list | Medium | The calendar can highlight a year of activity, but the list is capped at 100 sessions, so a clicked day can look empty | `routes/sessions.ts`, `SessionsPage.tsx` | Small–medium |
| M11 | Replay analysis / live HUD | Medium | Even after H1, live play and the timing overlay do not apply rate / EZ / HR / Classic to the windows they draw | `liveManiaPlay.ts`, `ScoreReplayModal.tsx`, `BeatmapPreviewModal.tsx` | Small once H1 helpers exist |
| M12 | Cross-cutting | Medium | `nomodOrMirrorOnlySql` disagrees with `isNomodOrMirrorOnly` (Classic is allowed in one, banned in the other) | `scoreGrade.ts`, `packages/mania-judge/src/mods.ts` | Small |
| L1 | Stats / Home charts | Low | Recharts `type="monotone"` can overshoot; weekly/home tooltips also dump raw `totalPp` | `StatsPage.tsx`, `DashboardPage.tsx` | Small |
| L2 | Practice library (distribution) | Low | Best-accuracy / best-score histograms are sound; misses filters still use `$.miss` only (see H3) | `query-language/execute.ts` | Bundles with H3 |
| L3 | Practice profile / Now selected | Low | Density-over-time downsamples by index (peaks can be skipped) and the X axis is categorical, not time-scaled | `computePatternAnalysis.ts`, `DensityOverTimeChart.tsx` | Small |
| L4 | Practice cards, mastery sort | Low | Mastery blend (`acc*0.5 + log10(plays+1)*50*0.25 + pp/5*0.25`) is arbitrary and PP-starved mania scores look “unmastered” | `analytics/mastery/formulas/simple.ts` | Product decision |
| L5 | Score cards | Low | `formatPp` rounds to 0 decimals; estimates and stored PP can look tied when they are not | `public/lib/format.ts` | Trivial |
| L6 | Stats (comfort / recommend) | Low | Empty axes copy overall skill (`comfortRc = rc > 0 ? rc : overall`), so recommendations can target a Rice level the player has never played | `sevenKSkill.ts` | Small; related to M1 |
| L7 | Overlay, Settings, Skin, Hub admin, Rating Lab, Marathon, Collections | Low | No additional mania *formula* defects found at this pass; remaining issues are UX / already-fixed findings | various | n/a |

---

## Page map

Hash history (`createHashHistory` in `router.tsx`). The desktop window loads `http://127.0.0.1:4321/#/…`. Rating Lab is omitted in the desktop shell.

| Route | UI | API | Data / computation |
|-------|----|-----|--------------------|
| `/` | `features/dashboard/DashboardPage.tsx` | `GET /api/dashboard` (`routes/dashboard.ts`) | Recent scores + `resolveScorePp`; `getWeeklyActivity` ← `weekly_stats`; `getPracticeSnapshot` ← `daily_stats` + last closed session; `getCurrentSession` |
| `/stats` | `features/stats/StatsPage.tsx` (+ `statsHelpers.ts`, `PatternShapesSection`, `SkillBandPlaysPanel`) | `GET /api/stats`, `GET /api/stats/skill-plays` (`routes/stats.ts`) | `getPlayerStats` / `streamManiaPass` → skill (`sevenKSkill`), progression, ranks, skillset mix, Patterns, mappers, sessions. Cache: `playerStatsCache` |
| `/practice` | `features/practice/PracticeListPage.tsx` | `GET /api/practice`, `/sample`, `/distribution`, `/recommend` (`routes/practice.ts`) | Query language `searchBeatmaps` / `practiceDistribution`; mastery + dan ratings; `recommendSevenK` |
| `/practice/$beatmapId` | `PracticeProfilePage.tsx` + `ScoreCard`, `ScoreReplayModal`, `ReplayAnalysisPanel`, `DensityOverTimeChart` | `GET /api/practice/:id` (and beatmap / replay / pattern routes) | Mastery + score history; pattern analysis; replay `simulateManiaJudgments` |
| `/sessions` | `SessionsPage.tsx`, `SessionActivityCalendar.tsx` | `GET /api/sessions` | `listSessions(100)`, `getCurrentSession`, `getDailyActivity(371)` |
| `/sessions/$sessionId` (`current` allowed) | `SessionDetailPage.tsx`, `SessionShareCard`, `SessionSuggest`, `SessionTosuLivePanel` | `GET /api/sessions/:id` | `listSessionScores` (default 50, max 500), `countSessionPbs`, `resolveScorePp`, `parseScoreStatistics`, `pickPbCompare`; live tosu on current |
| `/now-selected` | `NowSelectedPage.tsx` | tosu live + beatmap analysis / pattern routes | Live accuracy from tosu (normalised 0–1); density chart for the selected map |
| `/collections` | `CollectionsPage.tsx` | `GET /api/collections` | Local + osu! collections |
| `/collections/$collectionId` | `CollectionResultsPage.tsx` | collection results / search | Same query-language cards as Practice |
| `/download-maps` | `DownloadMapsPage.tsx` | `routes/mirrors.ts` | Mirror search / download; no player-stat formulas |
| `/marathon` | `MarathonPage.tsx` | `routes/marathon.ts` | Concatenate mania charts; key-count already filtered at add (F-064 fixed) |
| `/hub`, `/hub/$id`, `/hub/share`, `/hub-callback` | `features/hub/*` | Hub client / OAuth | Sharing collections; not local skill math |
| `/hub/admin/cache`, `/hub/admin/calc-bundles` | admin pages | Hub admin APIs | Operator tools |
| `/rating-lab` | `RatingLabPage.tsx` (non-desktop only) | `routes/ratingLab.ts` | Experimental mania-rating curves / PP-by-accuracy tiers |
| `/dev/parity` | `ManiaParityPage.tsx` | `routes/maniaParity.ts` | Dev comparison of difficulty ports vs upstream |
| `/bms` and `/bms/…` | `features/bms/*` | `routes/bms.ts`, `packages/db/src/bmsInterpret.ts` | BMS EX / lamps / tables; judgment keys share H3 |
| `/settings`, `/skin` | `SettingsPage.tsx`, `SkinPage.tsx` | `routes/settings.ts`, `routes/skins.ts` | Username / gamemode scope, axis thresholds, skins |
| `/overlay` | `OverlayPage.tsx` (no AppShell) | `routes/overlay.ts`, tosu | In-game overlay; not a stats calculator |
| `/overlay-editor` | `OverlayEditorPage.tsx` | overlay profile APIs | Layout editor |

Shared domain packages: `@roxysu/mania-judge` (windows, mods, accuracy-from-counts, replay sim), `@roxysu/mania-difficulty` (rework stars), `@roxysu/mania-pattern-analysis` (shapes), `@roxysu/osu-chart` (`.osu` parse), realm-reader (`apps/realm-reader/src/map.ts` `mapScore`) → SQLite `scores` / `beatmaps`.

---

## Domain formulas (baseline)

### Accuracy

Realm `scores.accuracy` is copied from lazer `Score.Accuracy` (`map.ts` line 210) and treated everywhere as a **0–1 fraction**. The UI multiplies by 100 (`formatAccuracy`). Tosu sometimes reports 0–100 and is divided in `tosu/client.ts` before the UI sees it.

Simulated / live accuracy uses `accuracyFromCounts` in `packages/mania-judge/src/windows.ts`:

```
acc = (305*MAX + 300*300 + 200*200 + 100*100 + 50*50 + 0*miss) / (305 * totalHits)
```

This is lazer-style *display* accuracy (MAX is worth 305, not 300). It is **not** stable ScoreV1, where MAX and 300 are both worth 300 and a full-300 play is 100%. Worked numbers (1000 objects):

| Judgments | Roxysu / lazer 305 | ScoreV1 (300-scale) | ScoreV2-style 320 (sometimes cited on the wiki) |
|-----------|--------------------|---------------------|--------------------------------------------------|
| All MAX | 100.0000% | 100.0000% | 100.0000% |
| All 300 | 98.3607% | 100.0000% | 93.7500% |
| 990 MAX + 10 300 | 99.9836% | 100.0000% | 99.9375% |
| 980 MAX + 15 300 + 5 200 | 99.8033% | 99.8333% | 99.7188% |

The app does not recompute stored score accuracy from judgments; it trusts Realm. The 305 formula only applies to replay simulation and the live keyboard judge. `ReplayAnalysisPanel` already warns when simulated accuracy differs from the stored value — that warning will fire more often until H1 is fixed, and also for Classic/ScoreV1 scores whose stored accuracy is 300-scale.

### Hit windows

`maniaHitWindows(od)` implements the *old stable / Classic* linear OD curve (`64 - 3*OD`, …) except the miss window uses **`178 - 3*OD`**. Official lazer Classic (non-convert) miss is **`188 - 3*OD`**. Default (non-Classic) lazer uses the same Great–Meh curve but a **variable MAX window** `(22.4, 19.4, 13.9)` at OD 0/5/10, then `Math.Floor(width * rate / difficultyMul) + 0.5`. See H1.

### PP and stars

- Stored `scores.pp` is preferred.
- If it is null, `resolveScorePp` interpolates the lazer-master NM/Mirror curve (`interpolatePpFromAccuracy`). Rate mods, EZ, HR, NF, etc. are never estimated.
- Stars on cards are lazer `starRating` and/or rework (`sunny_star` / `estDiff`). DT/HT/Invert plays should show the dan-variant row when the variant job has computed it; otherwise the star is missing, not the NM value.
- Skill bands (Push / Accuracy / Consistency) are a **weighted mean of rework ★** in an accuracy window, not official PP. Push defaults to roughly 90%+ (customisable). That is Roxysu/Companella-style, not osu! PP.

### Time buckets

Every day/week key is **UTC**: `toISOString().slice(0, 10)` and Monday-start UTC weeks (`getUTCDay()`, Sunday → −6). Chart axis labels (`formatChartDay`) parse `YYYY-MM-DD` as calendar parts and do not shift a day. The remaining timezone risk is *bucketing* (a 23:30 Lisbon play in summer / UTC+1 lands on the next UTC day), not the axis formatter.

---

## Recommended fix order

1. **H1 + M11** — one hit-window module that can express default lazer, Classic, convert, rate, EZ, and HR. Point the replay sim, live judge, and timing overlay at it. This is the only issue that can mis-judge a replay the player is looking at.
2. **H3** — one `parseScoreStatistics` that accepts lowercase, PascalCase, and integer `HitResult` keys. Use it from session/practice cards, BMS interpret, and the `misses:` SQL (`json_extract` of `$.Miss` / `$.miss` / `$.3` or a stored canonical column).
3. **H2 + L1 tooltips** — `weeklyActivity.avgAccuracy` should use `accCount`, like the daily trend. Give Home and Stats weekly tooltips explicit formatters (plays, optional accuracy as percent, optional PP) so raw 0–1 values and summed PP never leak.
4. **M1 + L6** — do not silently substitute overall skill onto an empty axis in the chart or in recommendations.
5. **M5** — apply the same `graded` gate to skill / Patterns / skillset candidates that accuracy averages already use.
6. **M3 + M2 + M7 + M4** — decide UTC vs local once; fix streak policy; sample skill history by calendar days; gap-fill accuracy / weekly activity so charts do not invent trends.
7. **M8** — invert or replace the comfort recency exponent and lock it with a test (highest-★ play must not be the *least* weighted).
8. **M6, M9, M10, M12** — skillset-mix unit (maps vs plays), X-grade definition, session list vs calendar, SQL vs JS mod gates.
9. **L2–L5, L7** — polish, mastery policy, density downsample, PP decimals.

Suggested PR grouping: (H1+M11), (H3+L2), (H2+L1), (M1+L6+M5+M8), (M2+M3+M4+M7), (M6+M9+M10+M12).

---

## H1 — Hit windows do not match lazer (miss 10 ms too tight; MAX is a fixed 16 ms)

**Severity:** High (replay analysis, live practice HUD, timing visualizer)  
**Pages:** Practice profile (replay), Session detail (replay), Now selected / preview notefield, any live keyboard play

### Where

`packages/mania-judge/src/windows.ts` is the single source used by the server replay simulator and, via `public/lib/maniaWindows.ts`, the renderer:

```18:28:packages/mania-judge/src/windows.ts
export function maniaHitWindows(od: number): HitWindows {
  const trunc = (n: number) => Math.trunc(n);
  return {
    perfect: 16,
    great: trunc(64 - 3 * od),
    good: trunc(97 - 3 * od),
    ok: trunc(127 - 3 * od),
    meh: trunc(151 - 3 * od),
    miss: trunc(178 - 3 * od),
  };
}
```

Rate scaling exists, but is skipped at rate 1, so the official `Floor(w) + 0.5` never applies to NM plays:

```164:172:packages/mania-judge/src/mods.ts
export function scaleManiaHitWindows<T extends Record<string, number>>(
  windows: T,
  rate: number,
): T {
  if (rate === 1) return windows;
  const scale = (n: number) => Math.floor(n * rate) + 0.5;
  return Object.fromEntries(
    Object.entries(windows).map(([key, value]) => [key, scale(value)]),
  ) as T;
}
```

`simulateManiaJudgments` does adjust OD for EZ/HR and then scales by rate. `LiveManiaPlay` and the timing overlay often call `maniaHitWindows(od)` with **no** rate, EZ, HR, or Classic flag (see M11).

Official lazer (`ManiaHitWindows.cs`, fetched 2026-11-17):

- **Default (no Classic):** DifficultyRange interpolation, then `Floor(width * speed/difficulty) + 0.5`. Perfect range is `(22.4, 19.4, 13.9)` at OD 0/5/10 — **not** a flat 16 ms. Miss range is `(188, 173, 158)` = `188 - 3*OD`.
- **Classic, non-convert:** Perfect 16, Great/Good/Ok/Meh match `64-3*OD` … `151-3*OD`, miss is **`158 + 3*(10-OD)` = `188 - 3*OD`**, all passed through `Floor(* multiplier) + 0.5`.

Great–Meh in Roxysu already match the linear curve. Two things do not.

### What happens and why

Node probe of half-windows in milliseconds:

| OD | Roxysu MAX / miss | Lazer default MAX / miss | Lazer Classic MAX / miss |
|----|-------------------|--------------------------|--------------------------|
| 0 | 16 / 178 | 22.5 / 188.5 | 16.5 / 188.5 |
| 5 | 16 / 163 | 19.5 / 173.5 | 16.5 / 173.5 |
| 8 | 16 / 154 | 16.5 / 164.5 | 16.5 / 164.5 |
| 10 | 16 / 148 | 13.5 / 158.5 | 16.5 / 158.5 |

The miss typo (`178` vs `188`) is 10 ms on every map, Classic or default. At OD 8 a hit 160 ms late is a **miss in Roxysu** and a **50 (meh) in lazer**. At OD 10, Roxysu’s 16 ms MAX window is *looser* than lazer default (13.5), so a 15 ms error is drawn as MAX in the overlay and judged Great in the actual game.

`judgeError` also `Math.round`s the raw error before comparing, which is a further half-millisecond disagreement with lazer’s `+ 0.5` windows.

The simulator comment already calls itself “approximate … not a full lazer ruleset sim”, but the timing histogram, miss list, and live accuracy are presented to the player as analysis of *their* play.

### Worked example

Map OD 8, no mods, a single rice note hit 160 ms late:

- Roxysu: `miss` window 154 → **miss**, combo break, 0 contribution to simulated accuracy.
- Lazer (default or Classic): miss window 164.5, meh window 127.5 → **50 / Meh**, combo kept.

A 1,000-note chart with ten such late hits would show ten extra misses in the analysis panel and a large accuracy gap versus the stored score (the panel’s “simulated accuracy differs” banner).

### Impact on the player

Wrong miss markers on replay review, wrong live accuracy/combo during in-app practice, and a timing bar that paints “MAX” or “miss” on the wrong side of the real window. For a mania player this is the difference between “I late-missed” and “that was a 50”.

### Proposed fix

Port `ManiaHitWindows.updateWindows` (default + Classic + convert) into `mania-judge`. Always apply `Math.floor(w * speedMul / diffMul) + 0.5`. Keep `178` nowhere. Expose `{ classic, convert, rate, easy, hardRock }` on both `maniaHitWindows` and `LiveManiaPlay`. The replay API should pass the score’s CL/V2 mods and rate already parsed by `parseScoreMods`.

### Alternatives and trade-offs

- Fix only the miss typo (`188`) and leave MAX at 16. Cheap, still wrong for default lazer MAX (especially OD 10 and OD 0–5) and still missing `+ 0.5`.
- Keep a documented “stable-style overlay” and label it. Honest, but the product’s own replay accuracy will keep disagreeing with lazer.

### How to test the fix

Unit-test windows at OD 0, 5, 8, 10 against the table above (default and Classic, rate 1 and 1.5). Add a judge fixture: error 160 ms at OD 8 is meh, not miss; error 15 ms at OD 10 default is great, not perfect. Re-run `liveManiaPlay.test.ts` (it currently expects miss window `maniaHitWindows(8).miss`, so those expectations must change). Golden-test one replay’s simulated accuracy against a known lazer score if a fixture is available.

---

## H2 — Weekly average accuracy divides by all plays, including fails

**Severity:** High (wrong number in a player-facing tooltip; contradicts the Stats accuracy rule)  
**Pages:** Stats (weekly activity tooltip), Home (weekly activity tooltip)

### Where

Daily accuracy in the same function correctly uses `accCount`. Weekly accuracy does not:

```782:797:apps/server/src/analytics/playerStats.ts
  const accuracyTrend = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => ({
      day,
      avgAccuracy: b.accCount > 0 ? b.accSum / b.accCount : null,
      playCount: b.playCount,
    }));

  const weeklyActivity = [...weekly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, b]) => ({
      weekStart,
      playCount: b.playCount,
      totalPp: b.totalPp,
      avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
    }));
```

`bumpBucket` only adds accuracy for `graded` plays (`rank !== -1`), so `accSum` omits fails while `playCount` includes them. The knowledge doc (`features/stats/index.md` rule 3) already requires weekly averages to use graded plays and to return `null` when a week has no graded play.

`StatsPage` and `DashboardPage` attach a default Recharts `<Tooltip>` to `data={weekly}` with no `formatter`. The data objects also carry `avgAccuracy` and `totalPp`, so the hover lists them.

### What happens and why

Fails contribute 0 to the numerator and 1 to the denominator. The mean is pulled toward 0 in proportion to rage-quits, not toward the player’s pass accuracy.

### Worked example

A week with two 98% passes and two quits (`rank = -1`):

- `accSum = 0.98 + 0.98 = 1.96`, `accCount = 2`, `playCount = 4`
- Tooltip today: `avgAccuracy = 1.96 / 4 = 0.49` → looks like **49%** (or the raw `0.49` if it is not multiplied by 100)
- Correct: `1.96 / 2 = 0.98` → **98%**
- A week of only fails should be `avgAccuracy: null`, not `0`.

The Stats *daily* accuracy-trend chart is not affected (it uses `accCount` and multiplies by 100 in `accChart`). The bug is the weekly payload and any UI that prints it.

### Impact on the player

A practice-heavy week with a lot of retries/fails looks like a collapse in accuracy on hover, even though the accuracy-trend chart (daily, graded only) is fine. That is exactly the kind of mixed signal that makes a player distrust the tool.

### Proposed fix

```ts
avgAccuracy: b.accCount > 0 ? b.accSum / b.accCount : null,
```

Add explicit tooltip formatters on both weekly bar charts: `playCount` as “plays”, `avgAccuracy` as a percent (or omit it until this is fixed), `totalPp` as “sum of play PP” (it is not “PP gained”). Add a `playerStats` test that mirrors the four-play example.

### Alternatives and trade-offs

Drop `avgAccuracy` / `totalPp` from the weekly payload if the bars are only meant to show volume. Still fix the field if anything else consumes the API.

### How to test the fix

The existing Stats fixture in `playerStats.test.ts` should include a week with mixed graded + ungraded plays and assert `avgAccuracy === mean(graded)` and `playCount === all`. Hover-test Home and Stats: the tooltip percent must match the daily chart for a week that has only those days.

---

## H3 — Judgment counts are parsed only from lowercase JSON keys

**Severity:** High (missing MAX/300/200/100/50/miss on score cards; wrong `misses:` search; BMS EX/lamps)  
**Pages:** Session detail, Practice profile, Practice library search, BMS profile / tables

### Where

```31:58:apps/server/src/scores/parseStatistics.ts
export function parseScoreStatistics(statistics: string | null | undefined): ScoreJudgments | null {
  // ...
  const judgments: ScoreJudgments = {
    perfect: readCount(raw, "perfect"),
    great: readCount(raw, "great"),
    // ...
    miss: readCount(raw, "miss"),
  };
  const hasKey = JUDGMENT_KEYS.some((key) => key in raw);
  if (!hasAny && !hasKey) return null;
  return judgments;
}
```

The tests only cover lowercase (`parseStatistics.test.ts`). Realm stores `Score.Statistics` as an opaque JSON string (`map.ts` line 214). When the realm-reader *writes* scores back, it already has to guess the client’s style:

```104:110:apps/realm-reader/src/writeOnlineScores.ts
function statStyle(sample: string | null): "pascal" | "lower" | "int" {
  if (!sample) return "pascal";
  if (/"\d+"\s*:/.test(sample)) return "int";
  if (sample.includes('"Miss"') || sample.includes('"Great"')) return "pascal";
  if (sample.includes('"miss"') || sample.includes('"great"')) return "lower";
  return "pascal";
}
```

Default is **PascalCase**. Integer keys (`"6"` for Perfect, etc.) are also recognised. The same lowercase-only read is used in:

- Practice search: `json_extract(s.statistics, '$.miss')` (`query-language/compile.ts` around line 440)
- BMS: `readCount(stats, "perfect")` etc. (`packages/db/src/bmsInterpret.ts` lines 232–239), so EX = `perfect*2 + great` and combo lamps go null or wrong

**Unverified:** a production `client.realm` was not opened, so the exact mix of styles in the wild is not counted. The write-path style detector is enough to show that PascalCase and int keys are expected.

### What happens and why

`{"Perfect": 980, "Great": 15, "Miss": 2}` has no lowercase keys → `parseScoreStatistics` returns `null` → `ScoreCard` shows no judgment line. `misses:<5` ignores those rows (SQL `json_extract` yields NULL). BMS `interpretBmsScore` sees null pgreat/great; after F-043, a missing miss also refuses a lamp, so the table looks unscored rather than over-lamped.

### Worked example

Stored statistics `{"Perfect":1000}` (all MAX). Parser returns `null`. The card cannot show `1000x MAX`. A lowercase `{"perfect":1000}` would display correctly. Two scores of equal accuracy therefore look different depending on which lazer build wrote the JSON.

### Impact on the player

The most useful mania score detail (MAX/300/200 split) disappears on session and map timelines. Library filters like “FC / 0 miss” and BMS lamps silently skip a large class of scores.

### Proposed fix

Centralise a parser that, for each judgment, tries lowercase, PascalCase (`Perfect`, `Great`, `Good`, `Ok`, `Meh`, `Miss`), and the `HitResult` integer codes used in `writeOnlineScores` (`ENUM_INT`). Treat a present key with value 0 as 0 (already done for lowercase). For SQL, either:

- persist a canonical `score_statistics` shadow table / columns at import, or
- extract `COALESCE(json_extract(..., '$.miss'), json_extract(..., '$.Miss'), json_extract(..., '$.3'))`.

Reuse the parser in `interpretBmsScore`.

### Alternatives and trade-offs

Normalising to lowercase in realm-reader at import is cleaner for SQL but requires a backfill of existing rows. A read-time-only fix leaves `misses:` broken until the SQL side is updated.

### How to test the fix

Extend `parseStatistics.test.ts` with PascalCase, mixed case, int keys, and all-zero PascalCase. Add a query-language test where the only 0-miss score uses `"Miss":0`. Add a BMS interpret test with `{"Perfect": 1}` producing EX 2.

---

## Home (`/`) — Dashboard

**Trace.** `DashboardPage` → `GET /api/dashboard`. Recent scores (8) with `resolveScorePp` and dan-variant stars. Practice snapshot from `daily_stats`. Weekly bars from `weekly_stats` via `getWeeklyActivity(db, 12)`. Current session from the session engine (30-minute gap).

Issues: **M3, M4, H2** (tooltip), **L1**.

---

### M3 — “Plays today” / streak are UTC, and the streak does not require today

**Severity:** Medium

### Where

```8:32:apps/server/src/analytics/practiceSnapshot.ts
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function computeActiveDayStreak(playCountByDay: Map<string, number>): number {
  const activeDays = [...playCountByDay.entries()]
    .filter(([, n]) => n > 0)
    .map(([day]) => day)
    .sort();
  if (activeDays.length === 0) return 0;
  let cursor = activeDays[activeDays.length - 1]!;
  let streak = 0;
  while ((playCountByDay.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addUtcDays(cursor, -1);
  }
  return streak;
}
```

`playsToday` / `playsLast7Days` use `utcDayKey(new Date())`. The dashboard labels are “Plays today”, “Last 7 days”, “Active-day streak” — no “UTC”. (The Stats weekday/hour charts *are* labelled UTC.)

### What happens and why

1. **Timezone.** A play at 23:30 in Europe/Lisbon during UTC+1 (summer) is stored on the next UTC date. “Plays today” can be 0 in the evening after a session, and yesterday’s count is inflated. The user_info timezone for this review is Europe/Lisbon (UTC+0 in November, UTC+1 in summer).
2. **Streak policy.** The cursor starts at the *most recent day that has plays*, not at today. Five days of play ending last Wednesday still show streak 5 on the following Monday.

The snapshot also reads only the latest 60 `daily_stats` rows (`limit(60)` plus a 59-day window). A gap longer than that window truncates the streak early, which is reasonable; the “last play day” start is the surprising part.

### Worked example

Plays on UTC dates Mon–Fri, none Sat/Sun. On Sunday the card still shows **Active-day streak: 5**. Most habit trackers would show 0 (or 5 until end-of-Saturday, then 0).

A 23:30 WEST (UTC+1) session on Saturday 18 April: `toISOString()` is Sunday 00:30 UTC → “Plays today” on Saturday night is unchanged, Sunday morning shows those plays as today.

### Impact on the player

Daily goals and streaks are the first numbers on Home. If they reset at UTC midnight or persist after a missed day, players will think the tracker is broken or, worse, trust a streak they already broke.

### Proposed fix

- Label the current behaviour “UTC” (consistent with Stats), **or** bucket `playsToday` / last-7 / streak in the local timezone (store an offset in settings; default `Intl` / desktop TZ).
- Define streak explicitly: either “current streak, broken if yesterday and today are both empty (today may still be in progress)” or rename the stat to “Last streak (ended D)”.
- Use a calendar window, not `LIMIT 60` rows, so 60 idle days cannot hide last month’s plays (the 59-day clamp already tries; `LIMIT 60` on sparse history is fine, on a 60-row cap of *recent* days is fine too).

### Alternatives and trade-offs

UTC-only is simpler and matches the rest of the pipeline (M2, session calendar). If you keep UTC, the label is mandatory. Local bucketing is what players expect of “today”.

### How to test the fix

Freeze `Date.now` at 00:30 UTC and 23:30 UTC±offset; assert `playsToday`. Seed five consecutive days ending two days ago; under a “current streak” policy the value must be 0.

---

### M4 — Weekly activity is 12 play-weeks, all keymodes, with fails in the accuracy field

**Severity:** Medium

### Where

`getWeeklyActivity` (`progression.ts`) is `ORDER BY week_start DESC LIMIT 12` — the last 12 *rows*, not the last 12 calendar weeks. Those rows come from `runStatisticsEngine`, which:

- applies username + gamemode scope but **not** key count,
- includes ungraded plays in `accSum / playCount` (no `rank !== -1` gate),
- stores `totalPp` as the sum of `resolveScorePp` (0 when missing).

`DashboardPage` plots `dataKey="playCount"` and uses a default tooltip (H2). Empty weeks are omitted, so bars sit next to each other.

### What happens and why

A player who practices 7K weekly and 4K once a month sees both in the Home bars. A player who plays one week a month sees 12 months squeezed into 12 adjacent bars; the axis labels jump (e.g. Jan, then Mar) but the visual spacing implies a continuous 12-week block. Fails drag the tooltip accuracy (same shape as H2, plus the missing graded filter in this engine).

The knowledge doc already flags the graded-play inconsistency with Stats as an open follow-up. It is filed here because Home is the default screen.

### Worked example

Plays in weeks of 6 Jan, 3 Feb, 3 Mar only, 20 plays each, plus 20 fails in March. The chart shows three equal-looking bars. Hover on March: `playCount` 40, `avgAccuracy` pulled down by the 20 fails. A “last 12 weeks” chart would be twelve slots with nine zeros.

### Impact on the player

Home “Weekly activity” cannot be compared to the Stats weekly chart (keymode-filtered, all-time, also gapless). Volume trends look denser than they are.

### Proposed fix

- Fill calendar weeks (zeros for idle weeks) for the last 12 *calendar* weeks, UTC or local (same decision as M3).
- Either reuse Stats’ keymode-aware, graded-accuracy buckets, or title the Home chart “All keyed mania plays (UTC weeks)” and fix the engine’s accuracy mean.
- Custom tooltip (H2).

### Alternatives and trade-offs

Keeping “weeks with data only” is acceptable if the axis is clearly a category of play-weeks, not a time scale — still fix accuracy and consider a key-count filter to match Stats.

### How to test the fix

Seed three isolated weeks; a 12-week series must contain nine zeros (or the title must not imply a continuous window). Assert March `avgAccuracy` ignores fails once the engine is aligned.

---

## Stats (`/stats`)

**Trace.** Search params: `granularity` (day|week), `skillTopPlays` (1–500), `skillAxis` (all|rc|ln|fln), `keyCount` (default 7). `StatsPage` → `GET /api/stats?granularity&skillTopPlays&keyCount`. Axis is client-side only (it does not refetch). `GET /api/stats/skill-plays` loads the expanded band list. Computation: `getPlayerStats` streams every scoped mania score of that key count (`b.circle_size = ?`) and folds summary, ranks, hours, days, daily/weekly buckets, mappers, and skill candidates.

Issues: **H2, M1, M2, M5, M6, M7, M8, M9, L1, L6**. Rank mix including all mods is documented and not re-filed.

---

### M1 — Axis skill-evolution falls back to the overall line

**Severity:** Medium

### Where

```105:122:apps/server/public/features/stats/statsHelpers.ts
export function historyBandValue(point, band, axis): number {
  if (axis === "all") return point[band];
  const key = `${band}${axis.charAt(0).toUpperCase()}${axis.slice(1)}` as ...;
  const axisValue = point[key];
  return axisValue > 0 ? axisValue : point[band];
}
```

`applyBandLevels` stores `0` when a band has fewer than `topN` maps (`sevenKSkill.ts`, `bandLevel`). Cold start and comfort skill also copy overall onto empty axes (L6).

### What happens and why

Selecting Rice on a history that has no Rice maps in band yet does not show a flat zero or a gap. It redraws the **All** Push/Accuracy/Consistency lines under a title like “Skill evolution (Rice)”. A later week that finally has 30 Rice maps will jump from “overall-shaped” history to the real Rice level.

### Worked example

`topPlays = 30`. Until week 20 the player has 10 Rice maps (band level stored as 0) and a Push-all of 6.2★. The Rice chart plots 6.2 every week. Week 21 reaches 30 Rice maps at 5.1★. The line drops from 6.2 to 5.1, which reads as a skill collapse rather than “Rice finally has enough samples”.

### Impact on the player

The axis toggle is the way to inspect Rice vs LN vs FLN growth. A copied overall line hides deficits and fabricates a crash when the real series starts.

### Proposed fix

If `axis !== "all"` and `axisValue === 0`, plot `null` (gap) or 0, never `point[band]`. Use `connectNulls={false}`. Surface “not enough maps yet” in the tooltip (the current skill cards already have `requiredPlays`).

### Alternatives and trade-offs

A faint overall reference series, clearly labelled “All (reference)”, can stay — as a separate key, not as a substitute for Rice.

### How to test the fix

A fixture with only LN plays: Rice history must be null/0, not equal to `point.push`. Toggle Rice in the UI; the line must not match All.

---

### M2 — Skill history can drop the first play’s calendar day

**Severity:** Medium

### Where

```841:849:apps/server/src/analytics/playerStats.ts
  const rangeDays =
    firstPlayed == null
      ? 1
      : Math.max(1, Math.ceil((Date.now() - firstPlayed) / 86_400_000));
```

`buildSampleKeys` then walks `nowMs - i * 86_400_000` and takes `utcDayKey`. The comment says the first play’s day is included. That is only true when the elapsed time, rounded up, covers the calendar span.

### What happens and why

Calendar days spanned = `utcDay(now) - utcDay(first) + 1`. `ceil(elapsed / 86400000)` is elapsed midnights, not that quantity.

### Worked example

First play Monday 23:00 UTC, “now” Tuesday 01:00 UTC. Elapsed = 2 hours, `ceil(2/24) = 1`. Only Tuesday is sampled. Monday’s play is visible to `asOfMs` of Tuesday (so Tuesday’s *value* includes it) but there is no point labelled Monday — the first day of the career is missing from the axis. The same pattern exists for week keys (`ceil(rangeDays / 7)` stepped from `now`).

### Impact on the player

All-time skill evolution is the career chart. Losing the first day/week is a small hole for long careers and a large one for someone who started last night.

### Proposed fix

```ts
const rangeDays = Math.max(1,
  utcDayIndex(Date.now()) - utcDayIndex(firstPlayed) + 1);
```

Generate keys from the first play’s UTC day/week through today, then downsample to 60 points if needed (keep first and last).

### How to test the fix

The two-hour Monday/Tuesday fixture must emit both keys. A first play at 00:01 UTC today must still emit a single day.

---

### M5 — Failed plays are excluded from averages but included in skill

**Severity:** Medium

### Where

`streamManiaPass` sets `graded = row.rank !== -1` and only then updates `accSum`. Candidates for skill, Patterns, and skillset mix are every non-hidden play:

```388:399:apps/server/src/analytics/playerStats.ts
    if (!row.hidden && row.beatmapId != null) {
      pass.candidates.push({
        beatmapId: row.beatmapId,
        mods: row.mods,
        accuracy,
        playedAt: Number(row.playedAt ?? 0),
        reworkStar: row.reworkStar,
        lnRatio: row.lnRatio,
        shape: row.shape ?? null,
        mapperKey,
      });
    }
```

`bestPlayPerMap` prefers higher variant ★, then accuracy. A failed DT play (variant star available) can beat a passed NM play on the same map. A mid-map quit at 91% still qualifies for the default Push band (`acc >= ~0.90`).

### Worked example

Map M, NM 98% pass at 5.0★, DT fail at 91% with variant 6.2★. Skill uses the DT fail (higher ★, still ≥ Push floor). Push level is pulled toward 6.2★ on a score the player did not finish. Accuracy trend for that day still uses only the 98% pass.

### Impact on the player

Skill and recommendations can be propped up (or distorted) by quits, while the accuracy chart tells a different story. NF clears (graded) should still count; ungraded quits should not.

### Proposed fix

Push a candidate only when `graded` is true (and keep fails in `playCount` / hours / weekday). Revisit whether an unrated fail should ever be a “best play per map”. Tests: the DT-fail vs NM-pass pair must pick the pass (or the fail must be ineligible).

### Alternatives and trade-offs

Some players want “highest attempted star”. If so, label the band “attempted” and do not mix it with “90%+ clears”.

---

### M6 — Skillset mix counts retries, not maps

**Severity:** Medium

### Where

`getSkillsetMix` increments `rc` / `ln` / `fln` once per *play* with a dan rating, not once per map. The bar chart is titled as a skillset mix and labelled “plays” in the tooltip, but the surrounding copy is about Rice / LN / FLN balance.

### What happens and why

50 retries on one Rice map and a single pass on an LN map show as 50 : 1. Axis thresholds are doing the right classification; the unit is what misleads.

### Worked example

10 unique Rice maps × 10 retries (all rated) + 10 unique LN maps × 1 play → bars 100 vs 10 (91% Rice) instead of 10 vs 10 (50%).

### Impact on the player

“I should practise more LN” may already be false; they simply retry Rice more. Recommendations that use `weakestAxis` on *skill* are separate; this chart is the visual they will quote.

### Proposed fix

Count distinct `(beatmapId, variant)` (same key `foldMapperRatings` uses), or show both “plays” and “maps”. If plays stay, change the title to “Plays by axis (retries included)”.

### How to test the fix

The 10×10 Rice vs 10×1 LN fixture should be 50/50 on a map-based mix.

---

### M7 — Accuracy-trend line skips idle days and interpolates across them

**Severity:** Medium

### Where

`accuracyTrend` emits only days with at least one play (`pass.daily` keys). `StatsPage` maps those to `accChart` and feeds a Recharts `LineChart` with `type="monotone"`. There is no gap filling and no `connectNulls={false}` on nulls (nulls only appear when a day has plays but zero graded plays).

### What happens and why

Plays on 1 Jan at 96% and 1 Feb at 99% become two points with a rising line through January, as if accuracy climbed on days with no data. Combined with `type="monotone"` (L1), the segment can overshoot 99%.

The Y domain (min−5 … 100) is a good choice for high-accuracy players and is not a bug.

### Proposed fix

Build a continuous UTC (or local) day series from first to last, set `avgAccuracy: null` on idle days, and `connectNulls={false}`. Optionally use `type="linear"`. A “show days with plays only” toggle can preserve the current view.

### How to test the fix

Two graded days 30 days apart must not produce a 30-day sloped line; the path should break.

---

### M8 — Comfort-skill “recency” weights the lowest star in the top N the most

**Severity:** Medium (affects recommendations more than the three visible band cards)

### Where

```38:39:apps/server/src/analytics/recommend/sevenKSkill.ts
/** Recency decay per play index (Companella uses 0.95). */
const RECENCY_DECAY = 0.95;
```

`topRatedPlays` is sorted **highest rework ★ first**. Then:

```686:689:apps/server/src/analytics/recommend/sevenKSkill.ts
    const recencyWeight = Math.pow(RECENCY_DECAY, total - i - 1);
    const combined = recencyWeight * accuracyWeight(play.accuracy);
```

For `n = 30`, `i = 0` (hardest map) gets `0.95^29 ≈ 0.226`; `i = 29` (easiest of the top 30) gets `0.95^0 = 1`. The name is “recency”, but the index is not time-based (`playedAt` is ignored here). Band levels (`clearLevelFromPlays`) use a correct time recency; this loop only builds `overall` / `rc` / `ln` / `fln` “comfort” skill, which `calculateMapMatch` uses when `skillMode === "comfort"` (the default for recommendations).

**Unverified:** Companella’s own 0.95 convention was not re-read. If they also sort best-first, the usual convention is `0.95^i` with `i = 0` full weight (same shape as osu! weighted PP). If they sort worst-first, the current exponent would be right. Given this file’s sort, the exponent is inverted.

### Worked example

Top 2 maps, equal accuracy: 7★ and 5★. Comfort overall today is `(7*0.95 + 5*1) / 1.95 ≈ 5.97`, closer to 5 than to 7. After a one-line exponent swap it would be `(7*1 + 5*0.95) / 1.95 ≈ 6.03`, closer to the harder map. At top 30 the hardest map has only ~23% of the weight of the easiest.

### Impact on the player

Recommendations aimed at “comfort” undershoot the player’s top-end and overfit farm maps. The Push / Accuracy / Consistency *cards* are unaffected.

### Proposed fix

Use `Math.pow(RECENCY_DECAY, i)` after a highest-★ sort, **or** sort by `playedAt` ascending and keep the current exponent, and rename the weight to “rank decay” vs “time recency”. Add a test that a harder equal-acc play is not down-weighted below a easier one solely by index.

### How to test the fix

The two-map example above; plus a time-sorted fixture if you switch to real recency (an older 7★ must decay relative to a new 7★).

---

### M9 — Grade “X” is only `total_score === 1_000_000`

**Severity:** Medium  
**Unverified on live lazer scores.**

### Where

```18:24:apps/server/src/query-language/scoreGrade.ts
  if (rank === -1) return null;
  if (Number(totalScore) === PERFECT_TOTAL_SCORE) return "X";
  if (rank === 6 || rank === 7) return "SS";
```

`PERFECT_TOTAL_SCORE = 1_000_000`. Rank 6/7 (X/XH in lazer’s enum) becomes the **SS** bucket unless the raw total is exactly 1 million. Stats rank bars and `grade:X` queries share this. The comment says “X = 1,000,000 — all Marvelous”. That is the ScoreV1 / Classic ceiling, not necessarily lazer standardised score.

### What happens and why

A all-MAX play under default lazer scoring may have a total other than 1,000,000 (standardised totals are not the Classic cap). It is filed as SS, not X. Conversely, a Classic 1,000,000 that is not all-MAX should not happen, but any exact 1,000,000 (including a transferred or rounded value) is painted X without checking judgments.

### Impact on the player

The “X” bar on the rank chart may stay at 0 even for players with many all-MAX scores, while SS looks inflated. Query `grade:X` will not find those plays.

### Proposed fix

Prefer judgments (all hits in `perfect`, miss=0) or `total_score === maximum_statistics` when available (after H3). Keep 1,000,000 as a Classic fallback. Document the rule next to the chart. Confirm against a real lazer all-MAX score (unverified here).

### How to test the fix

Fixture: rank 6, `totalScore` 2_500_000, statistics all perfect → X. rank 6, `totalScore` 990_000, mixed 300s → SS. rank 6, `totalScore` 1_000_000, Classic, all perfect → X.

---

## Sessions (`/sessions`, `/sessions/$sessionId`)

**Trace.** List: `GET /api/sessions` → `listSessions(db, 100)` + `getDailyActivity(db, 371)` + current session. Calendar: `SessionActivityCalendar` builds a UTC week grid (~53 weeks), fills cells from `daily_stats` (preferred) or from the sessions list (fallback). Clicking a day filters the in-memory list by `sessionStartedUtcDay(startedAt)`. Detail: `GET /api/sessions/:id` (or `current`) → `listSessionScores` (default 50, max 500, `hasMore`), `parseScoreStatistics` (H3), `resolveScorePp`, `pickPbCompare`. Sessions themselves are 30-minute-gap buckets (`SESSION_GAP_MS`) over scoped scores.

Issues: **M10, H3, H1/M11** (replay on a score), plus the calendar is UTC (labelled in code comments, not always in the heading).

Session PB ranking uses `resolveScorePp` in this commit (F-003 is fixed) and is not re-opened.

---

### M10 — The activity calendar can select a day the list cannot show

**Severity:** Medium

### Where

```144:154:apps/server/src/routes/sessions.ts
    const [items, current, activity] = await Promise.all([
      listSessions(db, 100),
      getCurrentSession(db),
      getDailyActivity(db, 371),
    ]);
```

`getDailyActivity` is “latest 371 *rows* of `daily_stats`”. The calendar then prefers those play counts. `listSessions` is the latest 100 sessions only. `SessionsPage` filters that array by the clicked UTC day and, if none match, shows “No sessions on this day.”

### What happens and why

A day six months ago can be a dark cell (plays from `daily_stats`) and still render an empty list, because the 100 most recent sessions do not include it. Conversely, if `daily_stats` is stale but a recent session exists, the calendar falls back to session totals (`fromStats > 0 ? fromStats : fromSessions`) — two sources that can disagree on the same day (all-mode daily_stats vs session score_count).

### Worked example

Player has 150 sessions, ~3 a week. The 100th-oldest started ~8 months ago. A cell from 10 months ago shows “12 plays · 2 sessions” (if sessionDayStats only come from the loaded 100, the “2 sessions” part may already be 0; `activity` still supplies 12 plays). Click: “No sessions on this day.” The player cannot open those sessions from the calendar.

### Impact on the player

The calendar looks like a full-year archive; it is only a year of *volume* plus a 100-session index. Older practice is visible but unreachable.

### Proposed fix

When a day is selected, query sessions whose `started_at` falls on that UTC (or local) day, without the global 100 cap (still cap the result, e.g. 50, with a link). Or raise the list limit and page it. Do not promise session counts on cells that were not loaded.

### How to test the fix

Seed 120 sessions across 120 days. Click a day older than the 100 newest; the list must return that day’s sessions, not the empty state.

---

## Practice library (`/practice`) and profile (`/practice/$beatmapId`)

**Trace.** List: `GET /api/practice` (query language, sort by last played / acc / misses / score / pp / mastery / stars) and optional `GET /api/practice/distribution` + `/recommend`. Cards use mastery `bestAccuracy` / `bestPp` / `bestMisses` (misses from statistics — H3). Profile: score timeline (`ScoreCard` + judgments), pattern density / hotspots, replay modal (`simulateManiaJudgments` + `ReplayAnalysisPanel`).

Issues: **H1, H3, M5** (if mastery ever counted fails — mastery engine uses `resolveScorePp` and best accuracy; failed low-acc plays usually lose), **M11, L2, L3, L4**. Distribution binning (`distributionAccuracy`) is carefully done in tenths of a percent and uses a 5th-percentile lower edge so one 0% score does not force 10-point buckets — no defect filed. `mod:… acc:` filters use the best matching score, documented in knowledge, not a bug.

Recommend (`recommendSevenK`) uses comfort skill (M8, L6) and a performance tweak of ±0.5★ around 90–95% (`mapMatch.ts`). That is a design choice; it is only wrong if comfort skill itself is wrong (M8).

---

### M11 — Timing overlay and live judge ignore rate / EZ / HR / Classic

**Severity:** Medium (completes H1)

### Where

```72:73:apps/server/public/lib/liveManiaPlay.ts
    this.windows = maniaHitWindows(args.overallDifficulty);
    this.missWindow = this.windows.miss;
```

```1396:1398:apps/server/public/components/ScoreReplayModal.tsx
                      windows={maniaHitWindows(
                        replayData.beatmap.overallDifficulty ?? 0,
                      )}
```

The same unadjusted call appears in `BeatmapPreviewModal.tsx` and `BeatmapPreviewEmbed.tsx`. The *simulator* on the server (`simulateManiaJudgments`) does call `adjustOverallDifficulty` + `scaleManiaHitWindows`. The overlay that the player stares at can therefore disagree with the simulated judgments on a DT replay, even after H1 is fixed, unless these call sites are updated.

### What happens and why

A 1.5× play’s real-world windows stay similar, but map-clock windows scale with rate in lazer. Drawing unscaled OD-8 windows on a DT replay mis-colours the timing bar. EZ/HR change OD (EZ ×0.5, HR ×1.4 capped at 10) and are also skipped here.

### Worked example

OD 8, DT 1.5. After H1, Classic/default miss ≈ 164.5 ms in map time at 1×; at 1.5× lazer uses `Floor(164.5 * 1.5) + 0.5 = 247`. The overlay still draws 154–164 ms. A 200 ms map-clock error (133 ms real time) is a meh/ok in-game and a miss on the bar.

### Proposed fix

Pass `parseScoreMods(score.mods)` (rate, EZ, HR, and a Classic flag) into `maniaHitWindows` / `LiveManiaPlay`. Preview can stay NM unless the preview itself has a rate control.

### How to test the fix

Replay fixture with DT: overlay windows must equal `scaleManiaHitWindows(base, 1.5)`. Live play with EZ: OD 8 → windows for OD 4.

---

### L2 — Practice “misses” distribution / filters share H3

**Severity:** Low by itself (blocked on H3)

`distributionMisses` and `misses:` compile to `json_extract(s.statistics, '$.miss')`. PascalCase scores are missing from the histogram and from “FC” style filters. Fix with H3. The accuracy and score histograms use mastery columns and do not have this problem.

---

### L3 — Density-over-time can drop peaks and treats time as categories

**Severity:** Low  
**Pages:** Practice profile, Now selected

`buildDensitySamples` is correct at 1-second windows (`notes / (windowMs/1000)`). Long charts cap at 7200 samples then `downsampleDensitySamples` keeps 120 points by **index stride**, not by max-NPS in the bin — a 1-second spike can fall between kept samples. `DensityOverTimeChart` uses `dataKey="timeLabel"` (`m:ss`) as a category axis, so after a stride the horizontal spacing is “one point = one kept sample”, not milliseconds. For a normal-length map (≤ 120 s of samples before downsample, or uniform stride) this is close enough.

### Proposed fix

When downsampling, keep the sample with max `notesPerSecond` in each stride (plus first/last). Optionally use a numeric `midpointMs` X axis.

### How to test the fix

A silent 100 s map with a 30 NPS chord at t=50 s and 5 NPS elsewhere, downsampled, must still show a peak near 30.

---

### L4 — Mastery score is an arbitrary blend and under-weights typical mania PP

**Severity:** Low (product formula, but it sorts the library)

```7:11:apps/server/src/analytics/mastery/formulas/simple.ts
  const acc = (input.bestAccuracy ?? 0) * 100;
  const playScore = Math.min(100, Math.log10(input.playCount + 1) * 50);
  const ppScore = Math.min(100, (input.bestPp ?? 0) / 5); // ~500pp → 100
  return clamp01to100(acc * 0.5 + playScore * 0.25 + ppScore * 0.25);
```

A 99.5% pass with 80 pp and 3 plays: `acc=99.5`, `playScore=min(100, log10(4)*50)≈30.1`, `ppScore=16` → mastery ≈ `49.75 + 7.5 + 4 = 61`. A 92% pass with 400 pp and 20 plays scores higher on the PP/volume legs. Many local mania scores have **null PP** (curve estimate is NM-only; F-003 fixed PB ranking but mastery still uses `bestPp` from the engine — if the engine now goes through `resolveScorePp`, estimated NM PP is included; rate scores with no stored PP contribute 0). The `/5` scale assumes ~500 pp is “max”, which is high for mid-level 4K/7K.

Not a “wrong formula” in the osu! sense — there is no official mastery — but sorting the practice library by mastery will not match “maps I’m best at” for players who care about accuracy. Prefer exposing the components, or cap PP against the map’s SS PP.

---

## Now selected (`/now-selected`)

**Trace.** Live tosu snapshot (accuracy forced into 0–1 when `> 1`) plus pattern density for the map in the client. Timing / HUD, if shown, uses the same window helpers as H1/M11.

No additional formula defect beyond **H1, M11, L3**. Tosu CS/object quirks (F-035) were previously filed; this pass did not re-audit the tosu client in depth. SSE play ticks before snapshot (F-065) is a race, not a formula error.

---

## Collections (`/collections`, `/collections/$collectionId`)

Collection results reuse the Practice search/cards (same mastery, misses, grades). No extra mania math. Smart-collection generation is out of scope for accuracy/PP; no new logic issue filed. F-048 (delete confirm) is UX, already recorded in-repo.

---

## Download maps (`/download-maps`)

Mirror browsing and downloads. No player performance formulas. Not expanded here.

---

## Marathon (`/marathon`)

Concatenates mania charts. Mixed key counts are rejected at add time in this commit (F-064 fixed). Remaining risk is export/PCM (F-034 / B1), not analysis math. No new formula issue.

---

## Hub (`/hub`, `/hub/$id`, `/hub/share`, `/hub-callback`, admin)

Sharing and Hub administration. No local skill averages. Admin/calc-bundle URL trust is a security finding (F-056), not a mania-logic one.

---

## Rating Lab (`/rating-lab`, non-desktop only)

Experimental rework / PP-by-accuracy curves (`PP_ACCURACY_TIERS = 100, 99.5, 97, 95, 93`). `interpolatePpFromAccuracy` accepts 0–1 or 0–100 (`accuracy <= 1 + 1e-9` then `* 100`). That branch is slightly sharp: an accuracy of exactly `1.000000001` would be treated as already-percent (1%) and estimate near-zero PP. Real scores are 0–1 and will not hit that; mention only as a footgun if a caller passes `1.5` meaning 1.5%. Linear interpolation between tiers is an approximation of the official curve, which is acceptable if the tiers come from the official calculator. No High/Medium filed.

---

## Mania parity (`/dev/parity`)

Developer comparison of the difficulty port vs upstream. It is the right place to lock H1’s window table, but it is not a player page. No extra issue.

---

## BMS (`/bms` and nested player / chart / compare / feed / statistics routes)

**Trace.** Local profile from Realm scores interpreted by `interpretBmsScore` (EX = `perfect*2 + great`, accuracy from the stored score, lamps after F-043 require present miss/bad/poor keys). Public pages read the Hub.

Issues: **H3** (PascalCase / int statistics → null EX and null lamps). F-041/F-042 (Hub trusts client grade / accepts autoplay) are Hub-trust findings, already in `findings/`. F-067 (public plays ignore variant) was previously filed; not re-verified line-by-line in this pass — treat as already tracked if still open, not as a new ID.

BMS accuracy is IIDX-style EX/max EX in comments, but `interpretBmsScore` sets `accuracy` from `input.accuracy` (lazer/BMS stored accuracy), not from `exScore/maxExScore`. If those ever diverge, DJ grade (`djGradeFromAccuracy`) follows the stored value. **Unverified** whether BmsRuleset’s stored Accuracy always equals EX/max EX. Worth a single fixture if you have a Realm BMS score; not filed without that evidence.

---

## Settings (`/settings`) and Skin (`/skin`)

Username and gamemode filters scope every Stats/Home/Practice query (`scoreScopeFilter`). Axis thresholds and recommend focus invalidate `playerStatsCache` in this commit (F-015 fixed). Skin editing has no score math. No new logic issue.

---

## Overlay (`/overlay`) and Overlay editor (`/overlay-editor`)

The overlay displays live / recent values; it does not recompute PP or skill. Desktop-shell URL and host lifetime issues are in the companion desktop review (L7, M7, M8 there). No additional formula issue.

---

## L1 — Monotone lines and leaky tooltips

**Severity:** Low  
**Pages:** Stats skill evolution, Stats accuracy trend, Home/Stats weekly bars

`Line type="monotone"` can overshoot extrema between points (classic spline look). Prefer `linear` for accuracy and skill, or keep monotone if you like the look but gap-fill (M7) first. Weekly/home default tooltips also print raw `totalPp` (sum of play PP, including estimated NM and zeros) without a unit label. Add formatters when fixing H2.

---

## L5 — PP displayed as an integer

**Severity:** Low

`formatPp` uses `toFixed(0)`. Two scores at 104.4 and 103.6 both show `104pp`, and a PB chip can look like a tie. Use one decimal for mania, or keep integers and compare with the full precision underneath (already true for PB ranking).

---

## L6 — Empty axes inherit overall comfort skill

**Severity:** Low (feeds M1 and recommendations)

```702:704:apps/server/src/analytics/recommend/sevenKSkill.ts
  const comfortRc = rc > 0 ? rc : overall;
  const comfortLn = ln > 0 ? ln : overall;
  const comfortFln = fln > 0 ? fln : overall;
```

A player with no FLN plays is treated as having FLN skill equal to overall. `weakestAxis` / `calculateMapMatch` can then recommend FLN maps at the wrong level, or fail to flag FLN as a deficit. Return 0 or `null` and let the recommender skip that axis until `MIN_PLAYS_FOR_SKILL` is met.

---

## M12 — SQL and JS “nomod or Mirror only” gates disagree on Classic

**Severity:** Medium  
**Pages:** Practice `grade:` filters vs PP estimation / stats helpers

`isNomodOrMirrorOnly` (`mania-judge` / `replay/mods.ts`) allows `MR` and `CL`. `nomodOrMirrorOnlySql` in `scoreGrade.ts` lists `CL` (and `V2`, `HD`, …) as disallowed, and only accepts Mirror if no disallowed acronym is present. A Classic-only score:

- *is* eligible for `resolveScorePp` curve estimation and JS-side “NM equivalent” variant handling,
- *is not* eligible for SQL `grade:` nomod checks that AND this predicate.

`HD` is also disallowed in SQL and ignored in the JS helper (HD does not change the pattern, but it is a gameplay mod). The two gates should share one allow-list. This does not change the Stats rank chart (all mods, by design).

### Proposed fix

Export one `STATS_ALLOWED_MODS` and generate the SQL from it, or drop `CL`/`V2` from the SQL blacklist if Classic is considered NM for grades.

### How to test the fix

A CL+MR score must get the same “nomod-or-mirror” answer in JS and in a compiled `grade:SS` query.

---

## L7 — Other pages: no additional mania formula issues in this pass

**Severity:** Low / informational

Overlay, overlay editor, Settings, Skin, Hub (including admin), Rating Lab, Marathon, Collections, and Download maps were traced far enough to see that they do not implement a second accuracy, PP, or skill formula. Remaining defects on those pages are UX, export, or already-fixed findings (F-015, F-064, F-048, desktop-shell overlay URL). Rating Lab’s `interpolatePpFromAccuracy` 0–1 vs 0–100 branch is noted under that page, not as a separate ID.

---

## Cross-cutting notes that were checked and not filed

- **Division by zero:** `accuracyFromCounts` returns 1 when there are no hits; bucket averages use `accCount > 0 ? … : null`; `weightedMean` falls back to an unweighted mean when total weight is 0. Session duration ignores `end < start`. Generally careful.
- **Duplicate scores:** IDs come from Realm UUIDs; skill uses one play per beatmap. No duplicate-row bug found in the aggregators.
- **Key count:** Stats and skill are strictly one keymode (`circle_size = keyCount`, default 7, 4K/7K always offered). Home weekly activity is the exception (M4).
- **DT/HT rate:** parsed from `speed_change` / `speedChange` with 1.5 / 0.75 defaults; first rate mod wins. Invert / Hold Off set dan variants (Invert = LN-only). Mirror is applied in the replay sim (column flip) and ignored for pattern shape.
- **PP interpolation** below the lowest tier goes linearly to 0 pp at 0% — rough, but rarely used for displayed scores.
- **`formatChartDay`** parses `YYYY-MM-DD` without timezone shift; no off-by-one on the label itself.
- **Session gap** of 30 minutes is a product choice, applied consistently.
- **Fixed in this commit, not re-opened:** F-003 (PB vs estimated PP), F-015 (stats cache vs Customize), F-016 (session/PB header scope), F-043 (BMS lamp on missing miss), F-064 (marathon mixed keys at add).

---

## Appendix — official references

- Lazer mania hit windows: [ppy/osu `ManiaHitWindows.cs`](https://github.com/ppy/osu/blob/master/osu.Game.Rulesets.Mania/Scoring/ManiaHitWindows.cs) (default DifficultyRange + Classic branch; miss = 188 − 3×OD, MAX default 22.4/19.4/13.9).
- osu! wiki “osu!mania / Accuracy” and “Score” pages describe ScoreV1 (MAX and 300 both worth 300 toward accuracy; 1,000,000 ceiling) vs later schemes. The 305-weight display formula used here matches lazer’s mania numeric judgments (Perfect=305), not ScoreV1.
- Roxysu skill / recommendations are Companella-inspired (`sevenKSkill.ts`, `mapMatch.ts`); they are not official ppysoft rankings.

---

## End
