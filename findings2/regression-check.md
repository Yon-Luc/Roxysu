# Regression check of F-001 to F-070

Phase 1 of the findings2 audit, run on 2026-10-19 against the current working tree (the fixes are uncommitted).

Four read-only reviewers each took a slice of the notes in `findings/`. For every note they read the fix in source and checked whether it holds. They also looked for bugs the fix introduced.

**Verification status:** the verdicts and candidate findings below are as the reviewers reported them. Phase 3 (re-verify every candidate in source) is not done yet, so treat the "New candidates" sections as unconfirmed until then.

## Summary

| Verdict | Count | Notes |
| --- | --- | --- |
| HOLDS | 57 | Fix is present and tested where testable |
| INCOMPLETE | 13 | Fix is present but misses a case |
| REGRESSED or ABSENT | 0 | |

Tests the reviewers ran: slice F-001..F-018 ran 114 tests, all passing. Slice F-019..F-036 ran 57 tests, all passing. Slice F-037..F-054 ran 53 tests, all passing. Slice F-055..F-070 reported no test run.

Notes that are not fully closed:

| Id | Why |
| --- | --- |
| F-002 | Staleness is wall-clock only, so a long live import can still be rebuilt over |
| F-011 | The sweep fails any import older than 10 minutes even if realm-reader is alive |
| F-016 | The session and PB header ignores keymode and soft-deleted-set scope |
| F-021 | Already marked partial: one scan and one compact record per play remain |
| F-025 | The remainder crawl after a truncated Hub dump restarts at mirror page 0 |
| F-027 | Edge TTL is not clamped to the row's remaining freshness, and there is no purge on commit |
| F-034 | The float copy is gone, but the WAV, zip and Blob still stack copies |
| F-038 | `childExited` ignores signal exits, so a crash never reaches the respawn policy |
| F-041 | The grade still comes from the client `accuracy`, and old rows were never recomputed |
| F-044 | All catalogue tables are fetched, but the tab shows a false empty state and swallows errors |
| F-057 | A desktop login that an attacker starts can still hand them the victim's JWT |
| F-064 | Loading the page from `?ids=` skips the key-count check |
| F-066 | The new "stop after failed polls" branch can never fire |

## Per-note results

### F-001 to F-018

| Id | Verdict | Reason |
| --- | --- | --- |
| F-001 | HOLDS | Stalled rounds still delete orphans; only catch-up is skipped; tests assert it |
| F-002 | INCOMPLETE | 10-minute wall-clock "stale" still lets rebuilds run on a live long import |
| F-003 | HOLDS | Retry engine, `pbCompare` and mastery share `resolveScorePp` and `comparePbRank` |
| F-004 | HOLDS | All three Realm writers use one lock plus a ref-counted pause; release is in `finally` |
| F-005 | HOLDS | Streaming 16 MiB cap, frame cap and header pre-check; bomb tests are real |
| F-006 | HOLDS | pid-alive gate, backoff and give-up; reset on a reachable probe |
| F-007 | HOLDS | SIGTERM then SIGKILL, memoized `shutdown`, `before-quit` awaits (no automated test) |
| F-008 | HOLDS | Skeletons while pending; errors in `text-danger`; empty copy hidden on error (no UI test) |
| F-009 | HOLDS | `commitImport` is one immediate transaction; a killed bootstrap re-runs as full |
| F-010 | HOLDS | `healFlaggedRows` compares ids both ways; equal-count tests are meaningful |
| F-011 | INCOMPLETE | Sweep fails any import older than 10 minutes even if the reader is alive |
| F-012 | HOLDS | Foreign keys on; delete order covers all parents; engines may now hit FK failures (candidate 4 below) |
| F-013 | HOLDS | 500-row streamed batches, per-batch hydration, capped id sets |
| F-014 | HOLDS | Probe, then backup, then the real write open; the test compares bytes |
| F-015 | HOLDS | PATCH invalidates the stats refresh on a threshold or focus change |
| F-016 | INCOMPLETE | Session and PB header ignores keymode and soft-deleted-set scope |
| F-017 | HOLDS | Memory guard, `paused` status, per-combo yield and `shouldContinue` |
| F-018 | HOLDS | `finish()` invalidates the stats refresh when rows were written |

### F-019 to F-036

| Id | Verdict | Reason |
| --- | --- | --- |
| F-019 | HOLDS | A null delta scans only if the mania fingerprint changed; three meaningful tests |
| F-020 | HOLDS | Window repair matches a full rebuild (random-timeline test); orphan and FK order is correct |
| F-021 | INCOMPLETE | Declared partial: still one scan plus a compact object per play |
| F-022 | HOLDS | Preview and commit refuse each other; commit deletes only its ids; the Realm writer dedupes by online id |
| F-023 | HOLDS | `/osu/budget` removed; 404 and 401 tests present |
| F-024 | HOLDS | Keyed single-flight per `osuUserId:ruleset`, cleared on settle |
| F-025 | INCOMPLETE | Hub-max remainder crawl restarts at mirror page 0; unreachable at default caps |
| F-026 | HOLDS | Public, admin, prime and cron all use `refreshCacheSingleFlight` |
| F-027 | INCOMPLETE | Edge TTL not clamped to remaining freshness; no purge on commit |
| F-028 | HOLDS | Async read, bounded LRUs, limiter of 2; no worker, as documented |
| F-029 | HOLDS | `hudJudgments` filter used by the rewatch HUD and `computeHud`; tests exist |
| F-030 | HOLDS | Button edge timeline replaces copied buttons; inter-frame tests assert results |
| F-031 | HOLDS | try/catch/finally with `Output.cancel()` and a guarded writable that aborts |
| F-032 | HOLDS | Uncapped presets stream via `StreamTarget`; capped presets keep the in-memory path |
| F-033 | HOLDS | `sanitizeZipEntryPath` applied on the writer, importers and fusion paths; hash validated |
| F-034 | INCOMPLETE | Float copy removed, but WAV assembly, zip and Blob still stack copies |
| F-035 | HOLDS | `keysFromCs` used in `parseTosuV2Message`; object and number tests |
| F-036 | HOLDS | Probe publishes only on a warning change; tests pass |

### F-037 to F-054

| Id | Verdict | Reason |
| --- | --- | --- |
| F-037 | HOLDS | Backoff respawn with give-up, timer cleared on shutdown, real tests. The fix has gaps (candidates D1, D2, D4, D5) |
| F-038 | INCOMPLETE | Policy and tests are right, but `childExited` ignores signal exits, so crashes never reach it |
| F-039 | HOLDS | Visible-before-present and throttled reassert present; still needs on-device validation |
| F-040 | HOLDS | `/bms/profile` only reads `localBmsOverview`; the pipeline derives scores |
| F-041 | INCOMPLETE | Grade still comes from client `accuracy`; old rows keep client grades |
| F-042 | HOLDS | `validateInbound` rejects `AT` mods; test asserts the reason and no stored row |
| F-043 | HOLDS | `comboLampFromCounts` returns null on a missing bad, poor or miss count; tested |
| F-044 | INCOMPLETE | Every catalogue table is fetched, but the tab shows a false empty state and swallows errors |
| F-045 | HOLDS | Ruleset and key filter done in the join; the test asserts zero `getById` calls |
| F-046 | HOLDS | Previous payload kept only for the same collection id; grid dimmed with `aria-busy` |
| F-047 | HOLDS | `keepPreviousData`, dimmed grid, stale-page buttons disabled, distribution query gated |
| F-048 | HOLDS | `ConfirmModal` stays busy through the refetch; i18n keys exist in en, es, fr and pt |
| F-049 | HOLDS | Modal sits outside the edge-revealed chrome; layer removal has an 8 s Undo toast |
| F-050 | HOLDS | Spinner while loading, error with Retry, create button only after a successful empty list |
| F-051 | HOLDS | Titled error panel with Retry on a scrim; on-media danger token defined |
| F-052 | HOLDS | Trap, `focusin` guard and focus restore present; `focusTrap` tests are real |
| F-053 | HOLDS | `truncate` and `line-clamp-2 min-w-0` with `title` tooltips applied |
| F-054 | HOLDS | Keyset pagination, 304 and tests are real. Server only: `fetchOwnedSetIds` has no caller |

### F-055 to F-070

| Id | Verdict | Reason |
| --- | --- | --- |
| F-055 | HOLDS | 20k cap checked in the handler and runner before any job state; route test asserts 400 and an idle job |
| F-056 | HOLDS | Upload always posts to `resolveHubBaseUrl()`; `hubUrl` field removed; test asserts the URL |
| F-057 | INCOMPLETE | Verifier blocks a snooping process, but an attacker-started desktop login still hands them the victim's JWT |
| F-058 | HOLDS | Keyset-paged stream is byte-identical to the old output; tests cover page boundaries and cancel |
| F-059 | HOLDS | Analytics awaited (3 s bound); jobs stopped; both entries call it before `closeDb`. Shutdown cost: candidate G4 |
| F-060 | HOLDS | Default CORS is the loopback origins; production and non-loopback `HUB_LISTEN` reject `*`; tested |
| F-061 | HOLDS | Reader opens without migrating and waits for the schema; `schemaVersion` tests cover it |
| F-062 | HOLDS | Catalogue is served at once and refreshed in the background on a 15-minute TTL; no test |
| F-063 | HOLDS | Page owns an `AbortController`, passes `signal`, shows Cancel, aborts on unmount, hides `AbortError` |
| F-064 | INCOMPLETE | `addIds` and `fillRecommend` filter by key count, but loading from `?ids=` does not |
| F-065 | HOLDS | A play tick with no snapshot invalidates the query unless a fetch is in flight; tests assert it |
| F-066 | INCOMPLETE | The new "stop after failed polls" branch can never fire |
| F-067 | HOLDS | Header shows the selected variant's play count. No test |
| F-068 | HOLDS | `loadRecentBmsSessions` pages until the oldest session closes; the gap comparison matches `groupBmsSessions` |
| F-069 | HOLDS | Knowledge rules 8 to 12 now describe the shipped charts, feed, stats, images and sessions |
| F-070 | HOLDS | `.rx-card-grid` hover animates only `transform` and an `::after` opacity; `(hover: hover)` guard and reduced-motion rule present |

## New candidates from the regression pass

Ids are provisional. Final `F2-NNN` ids are assigned in Phase 4.

### Reopen an existing note

| Cand | Reopens | Sev | Kind | Feature | Title |
| --- | --- | --- | --- | --- | --- |
| A1 | F-002, F-011 | medium | correctness | live-sync | A live import longer than 10 minutes is declared stale (no heartbeat) |
| A2 | F-016 | medium | logic-gap | stats | Stats header session and PB counts ignore keymode and soft-deleted sets |
| B1 | F-034 | medium | perf | map-marathon | Marathon export peaks at several copies of the WAV and deflates PCM on the main thread |
| D3 | F-041 | medium | security | bms | Hub grade derives from client `accuracy`; rows ingested before the fix were never recomputed |
| E1 | F-057 | medium | security | hub | An attacker-chosen desktop handoff id lets a phished login be redeemed remotely |
| D1 | F-038 | medium | correctness | in-game-overlay | Overlay host never respawns after a signal crash |
| E2 | F-066 | low | design-gap | in-game-overlay | The "stop when polls fail while disabled" branch is unreachable |
| E3 | F-064 | low | logic-gap | map-marathon | Opening Marathon from `?ids=` skips the same-key-count check |
| D6 | F-044 | low | design-gap | bms | Public BMS tables tab shows a false "no tables" and hides fetch errors |
| B3 | F-027 | low | correctness | hub | Edge TTL for a fresh Hub search page is not clamped to remaining freshness |
| B6 | F-025 | low | logic-gap | download-mirrors | Hub-max remainder crawl re-walks the pages Hub already supplied |
| B7 | F-030 | low | design-gap | preview-replay | Standard slider button edge is shifted 0 to 8 ms earlier than the recorded frame (inferred) |
| G4 | F-059 | low | perf | cross-cutting | Shutdown runs full coverage queries on the main thread, every 50 ms while waiting |
| G5 | F-062 | low | correctness | bms | BMS tables background refresh has an unhandled rejection path |
| G6 | F-057 | low | correctness | hub | Hub callback page redeems against the wrong Hub URL first and fires twice |

### Not tied to an earlier note

| Cand | Sev | Kind | Feature | Title |
| --- | --- | --- | --- | --- |
| D2 | medium | correctness | desktop | Desktop child processes have no `'error'` listener |
| A3 | low | correctness | cross-cutting | `PATCH /api/settings` on a score-filter change blocks behind a running import (regression from the F-002 fix) |
| A4 | low | correctness | sessions | Retry and mastery engines wipe then rewrite with no transaction, and foreign keys are now enforced (inferred) |
| B2 | low | logic-gap | hub | Public stale refresh ignores Hub refresh backoff and records no failure |
| B4 | low | design-gap | replay-video-export | A cancelled or failed streamed export leaves a 0-byte `.mp4` at the chosen path |
| B5 | low | correctness | tosu-live | An in-flight tosu probe can spawn tosu or restore warnings after tosu live is disabled |
| D4 | low | perf | desktop | Overlay and realm child log file descriptors leak on every respawn |
| D5 | low | logic-gap | desktop | Realm-reader respawn dead-ends when re-extract or the entry check fails |
| D7 | low | design-gap | cross-cutting | Command palette (Ctrl+K) opens over other modals with competing focus traps (inferred) |
| G7 | low | logic-gap | bms | Bundled BMS tables are stamped with the local clock, so they can outrank newer Hub versions (inferred) |

## Candidate details

### A1. A live import longer than 10 minutes is declared stale

Reopens F-002 and F-011. Medium, correctness, verified.

- **What:** Staleness is only `now - imports.started_at > 10 min`. The server sweep fails such a row while the reader is alive. The analytics gate also proceeds on it, because `importGateDecision` treats a stale row as "proceed".
- **Why:** A first full extraction of a large library can run past 10 minutes. The row then shows failed, and a full analytics rebuild reads the half-extracted mirror. That is the F-002 scenario. When the reader commits, the row flips to success and triggers another rebuild.
- **Fix:** Add a heartbeat (`imports.updated_at`, or a settings row the reader touches per batch). Define stale as no heartbeat for N minutes in both `failStaleRunningImportsOlderThan` and `isStaleRunning`.
- **Evidence:**
  - `apps/server/src/analytics/pipeline.ts:69-91`: stale is based on `startedAt` only, and stale means proceed.
  - `packages/db/src/failStaleRunningImports.ts:51-60`: the sweep gates on `started_at`.
  - `apps/server/src/sse.ts:91-98`: the sweep runs on every poll tick.
  - `packages/db/src/schema.ts:162-171`: the `imports` table has no heartbeat column.

### A2. Stats header counts ignore keymode and soft-deleted sets

Reopens F-016. Medium, logic-gap, verified.

- **What:** `streamManiaPass` filters on mania, `circle_size = keyCount` and non-deleted sets. `getSessionStats` filters only on username, gamemode and `s.delete_pending`.
- **Why:** With gamemode `*`, or an auto choice that resolves to several rulesets, `sessionCount`, `pbCount` and the session averages include osu!, taiko, catch and other keymodes. Switching 4K to 7K does not change them while the play counts do.
- **Fix:** Join `beatmaps` and `beatmap_sets` in `getSessionStats` and add the same predicates as `streamManiaPass`. Extend the scope test with a mixed-keymode fixture.
- **Evidence:**
  - `apps/server/src/analytics/playerStats.ts:230-238`: the main pass restricts to mania, keyCount and non-deleted sets.
  - `apps/server/src/analytics/playerStats.ts:436-445`: the session query lacks those predicates.
  - `apps/server/src/analytics/playerStats.ts:428-433`: its doc comment claims it matches the scoped charts.

### A3. Settings PATCH blocks behind a running import

Reopens F-002 as a side effect. Low, correctness, verified.

- **What:** The route awaits `runAnalyticsPipeline(db, {forceFull:true})`. The run now starts with an unbounded (up to 10 minutes) `waitForIdleImport`. If a run is already in flight the call returns early with `pending=true`, so the response can precede the rebuild.
- **Fix:** Fire and forget, and rely on `dashboard.updated` and `mastery.updated`. Or return 202 while the gate waits.
- **Evidence:** `apps/server/src/routes/settings.ts:561`, `apps/server/src/analytics/pipeline.ts:258`, `apps/server/src/analytics/pipeline.ts:235-240`.

### A4. Retry and mastery engines wipe then rewrite without a transaction

Low, correctness, inferred.

- **What:** `runRetryEngine` deletes `score_metrics` and then inserts in batches. `runMasteryEngine` does the same for `mastery`. Foreign keys are now enforced and a second process (the reader) also writes.
- **Why:** If the reader's commit phase deletes a score or beatmap between the engine's read and its inserts, the insert fails. The pipeline logs the error, but the table stays partly or fully wiped until the next successful run.
- **Fix:** Wrap each engine's delete and inserts in `db.transaction`, or pre-filter against current `scores` and `beatmaps`.
- **Evidence:** `apps/server/src/analytics/retry.ts:164-185`, `apps/server/src/analytics/mastery/engine.ts:195-206`, `apps/realm-reader/src/reconcileCore.ts:117-122`.

### B1. Marathon export peaks at several copies of the WAV

Reopens F-034. Medium, perf, verified.

- **What:** `assembleStereoWav` allocates a second full buffer while the PCM16 chunks are alive. `zipSync` at the default deflate level produces a third buffer, and `new Blob([zipped])` copies it again.
- **Why:** A marathon near the 60-minute cap (about 635 MB of PCM) peaks well above 1.3 GB. The synchronous deflate freezes the tab while it packs. The F-034 status line understates the peak.
- **Fix:** Build the WAV as `new Blob([header, ...chunks])`, zip with `{ level: 0 }` or stream with fflate `Zip`, drop `chunks` before zipping, and consider a 30-minute cap.
- **Evidence:** `apps/server/public/lib/marathonExport.ts:92-118`, `:166-167`, `:242-245`.

### B2. Public stale refresh ignores Hub backoff

Low, logic-gap, verified.

- **What:** Cron and admin refresh write `refreshBackoffUntil` on failure, and cron honours it. `maybeRefreshStale` never reads it and never records a failure.
- **Why:** While the upstream is failing or rate-limiting, every stale-hit request starts another full catalogue crawl, limited only by the 10 per minute per-IP limit.
- **Fix:** Skip the background refresh when `row.refreshBackoffUntil > now`, and persist `refreshError` and `refreshBackoffUntil` on failure like cron does.
- **Evidence:** `apps/hub/src/routes/search.ts:83-96`, `apps/hub/src/services/cacheRefreshCron.ts:17-33`, `apps/hub/src/services/cache.ts:276-288`.

### B3. Edge TTL is not clamped to remaining freshness

Reopens F-027. Low, correctness, verified.

- **What:** A `hit-fresh` page gets the full `edgeCacheTtlSecondsForRow` TTL even when the row turns stale seconds later. Nothing purges the edge when the refresh commits.
- **Fix:** `ttl = min(rowTtl, hubCacheTtlMs/1000 - ageSec)`, and send no-store when the remainder is under a few seconds.
- **Evidence:** `apps/hub/src/routes/search.ts:102-113`, `apps/hub/src/services/cache.ts:276-288`, `:492-501`.

### B4. Cancelled streamed export leaves a 0-byte `.mp4`

Low, design-gap, verified (the picker behaviour is inferred from the File System Access API).

- **What:** `showSaveFilePicker` runs in the click, but the writable opens only after audio decode and codec probes. An abort or throw before that point leaves an empty file at the chosen path.
- **Fix:** Call `FileSystemHandle.remove()` where available on failure or abort. Otherwise tell the user an empty file was left.
- **Evidence:** `apps/server/public/components/ScoreReplayModal.tsx:580`, `apps/server/public/lib/replayVideoExport.ts:1447`, `:1532`, `:1691-1694`.

### B5. In-flight tosu probe can spawn tosu after live is disabled

Low, correctness, verified.

- **What:** `refreshProbeAndMaybeSpawn` checks `settings.enabled` once before `await probeTosuHttp`. After the await it spawns without re-checking, and overwrites `warnings`.
- **Fix:** Capture `settings` and a generation counter before the await, and bail out after it if the adapter was stopped, restarted or disabled.
- **Evidence:** `apps/server/src/tosu/live.ts:131-136`, `:150`, `:163`, `:411-415`, `:444`.

### B6. Hub-max remainder crawl re-walks supplied pages

Reopens F-025. Low, logic-gap, inferred (assumes Hub and mirrors sort the same way).

- **What:** After a Hub dump truncated at 100,000 sets, the mirror crawl starts at page 0. At 100 sets per page the first 1,000 pages are all already seen, and `COUNT_MAX_PAGES` is 1000.
- **Fix:** Start at `floor(hubSeed.sets.length / MIRROR_PAGE_CAPACITY)` when the sort orders match, otherwise tell the user to narrow the filter.
- **Evidence:** `apps/server/src/mirrors/searchOnline.ts:526-550`, `:566`, `:648`, `:46`.

### B7. Standard slider button edge shifted up to 8 ms early

Reopens F-030. Low, design-gap, inferred.

- **What:** `buildButtonTimeline` places each press or release up to 8 ms before the frame that records it. If lazer stamps frames at the input event, the old "previous frame" behaviour was exact and the new one mis-scores ticks inside the 8 ms.
- **Fix:** Default the lookback to 0, or measure real lazer replay frame spacing before keeping 8 ms.
- **Evidence:** `apps/server/src/replay/stdJudge.ts:185`, `:203`, `apps/server/src/replay/std.test.ts:473-485`.

### D1. Overlay host never respawns after a signal crash

Reopens F-038. Medium, correctness, verified.

- **What:** `apply()` sets `childExited` from `overlayChild.exitCode !== null`. A child killed by SIGSEGV or SIGABRT has `exitCode === null` and `signalCode` set, so `decideOverlayApply` returns a no-op forever.
- **Why:** GTK and WebKit crashes are usually signals. The HUD stays dead until the app restarts.
- **Fix:** Use `exitCode !== null || signalCode !== null`, as `spawnRealmReader` does, and add a test for signal exits.
- **Evidence:** `apps/desktop/main.js:525`, `:333`, `apps/desktop/overlayApplyPolicy.js:94-103`.

### D2. Desktop children have no `'error'` listener

Medium, correctness, verified.

- **What:** `spawn()` failures (ENOENT, EACCES, a wrong-glibc overlay binary) emit `'error'` on the ChildProcess. Nothing in `main.js` listens, so it is an uncaught exception in the Electron main process, and the respawn timers re-trigger it.
- **Fix:** Add `child.on("error", ...)` for realm-reader, overlay and server that logs and feeds the respawn policy. Wrap the spawn calls in try/catch.
- **Evidence:** `apps/desktop/main.js:440-452`, `:359-373`, `:144-163`.

### D3. Hub grade derives from client accuracy

Reopens F-041. Medium, security, verified.

- **What:** `presentedScore` computes `djGrade` from the client `accuracy`, which is only range-checked. `exScore`, `maxExScore`, `accuracy` and the judgement counts are never checked against each other. Rows ingested before the fix keep client-supplied `djGrade` and `comboLampId`.
- **Why:** A non-Roxysu client can send `accuracy: 1` with 500 misses and get grade `max`, which public leaderboards and table completion count.
- **Fix:** Recompute accuracy from counts or reject a mismatch above a small epsilon, and run a one-off Hub job that re-presents existing `bms_scores`.
- **Evidence:** `apps/hub/src/services/bms.ts:126-137`, `:113-115`, `:247`, `apps/hub/src/services/bms.ingest.test.ts:101-129`.

### D4. Child log file descriptors leak on every respawn

Low, perf, verified.

- **What:** `openChildLogFd` pushes a new fd on every spawn, closed only in `shutdown()`. Realm respawns are capped at 6, but overlay liveness (15 s gap) and URL-change respawns are uncapped.
- **Why:** A crash-looping overlay leaks about 240 fds an hour. Reaching a 1024 soft limit makes `fs.openSync` throw EMFILE, which rejects inside `apply()` with no catch (the hours figure is inferred).
- **Fix:** Reuse one fd per label, or close the previous fd for that label on exit.
- **Evidence:** `apps/desktop/main.js:104-111`, `:437`, `:140`, `:636-644`.

### D5. Realm-reader respawn dead-ends on a failed re-extract

Related to F-037. Low, logic-gap, verified.

- **What:** If `ensureRealmExtracted` throws or `realmEntry` is missing, `spawnRealmReader` logs and returns. No further respawn is scheduled and the failure counter does not advance.
- **Fix:** Return a boolean or throw, and call `scheduleRealmRespawn` on failure so backoff continues.
- **Evidence:** `apps/desktop/main.js:336-345`, `:398-402`.

### D6. Public BMS tables tab: false empty state, hidden errors

Reopens F-044. Low, design-gap, verified.

- **What:** `tablesPending` derives only from `tableQueries`, which is `[]` until the catalogue resolves, so the browser renders "No difficulty table is available." Catalogue and per-table errors never reach the `error` prop.
- **Fix:** Include `catalogue.isPending` in `tablesPending` and surface catalogue and table errors with a retry.
- **Evidence:** `apps/server/public/features/bms/BmsPlayerPage.tsx:65-74`, `:122-125`, `:128-135`, `BmsProfileView.tsx:408`, `BmsTableBrowser.tsx:78`.

### D7. Command palette opens over other modals

Related to F-052. Low, design-gap, inferred.

- **What:** The Ctrl+K shortcut ignores only TEXTAREA, SELECT and contentEditable targets. With `ConfirmModal` open, both document-level handlers (Tab trap, Escape, `focusin` pull-back) run together.
- **Why:** Focus can bounce between dialogs, and one Escape closes both, cancelling a pending delete confirmation.
- **Fix:** Suppress the shortcut while another `[aria-modal=true]` exists, or add a modal stack where only the top modal handles Escape and Tab.
- **Evidence:** `apps/server/public/components/CommandPalette.tsx:640-654`, `:462-482`, `:264-266`, `apps/server/public/components/ConfirmModal.tsx:42-63`.

### E1. Attacker-chosen desktop handoff id

Reopens F-057. Medium, security, verified.

- **What:** `/auth/login?client=desktop&handoff=<id>&challenge=<c>` takes both values from the URL. The callback stores the victim's JWT under the attacker's id and challenge, so the sender of the link can call `POST /auth/handoff/<id>` with their own verifier.
- **Why:** A victim who clicks "Log in with osu!" from a crafted link hands the attacker a Hub JWT, an admin one if the victim is the admin. The verifier only protects against a third party who sniffs the id.
- **Fix:** The Hub always generates the handoff id. Pass a separate local nonce through the login state and echo it in the desktop redirect, so only the legitimate local server sees the Hub id.
- **Evidence:** `apps/hub/src/routes/auth.ts:65-76`, `:174-178`, `:201-217`, `apps/hub/src/services/oauthState.ts:106-130`.

### E2. F-066 "stop when polls fail" branch is unreachable

Reopens F-066. Low, design-gap, verified.

- **What:** The policy stops the host only when `lastKnownEnabled === false` and a child exists. `lastKnownEnabled` becomes false only on a successful poll that returns disabled, and that same tick stops the child.
- **Why:** The real case is the user turning the overlay off and the server dying before the next 4 s poll. The last read was still enabled, so the host keeps drawing. The unit test passes only because it feeds an input the shell never produces.
- **Fix:** After `OVERLAY_MAX_POLL_FAILURES` consecutive failures with a child alive, stop it regardless of `lastKnownEnabled`, and respawn when polls recover.
- **Evidence:** `apps/desktop/overlayApplyPolicy.js:50-62`, `apps/desktop/main.js:534`, `:542-543`, `:557-558`, `:671`.

### E3. Marathon `?ids=` skips the key-count check

Reopens F-064. Low, logic-gap, verified.

- **What:** The `initialIds` effect does `setTracks(data.sources.filter(isPlayableSource))` and never calls `partitionByKeyCount`.
- **Fix:** Run `partitionByKeyCount([], sources)` there and call `rejectKeyMismatch` for rejected maps.
- **Evidence:** `apps/server/public/features/marathon/MarathonPage.tsx:122-142`, `:196-206`, `:236-244`.

### G4. Shutdown runs full coverage queries on the main thread

Reopens F-059. Low, perf, verified path, inferred cost.

- **What:** Each `stopXBackfill(db)` returns `getXJobState(db)`, which computes coverage with full-table queries. The wait loop polls three of these every 50 ms.
- **Why:** On a large library, quitting during a backfill blocks the event loop and eats into the 5 s SIGKILL grace after the 3 s analytics wait, risking the mid-write kill F-059 meant to prevent.
- **Fix:** Add cheap status getters that read `job.status` only, and use them in `asyncJobStatuses` and the stop path.
- **Evidence:** `apps/server/src/shutdownJobs.ts:41-53`, `:98-103`, `apps/server/src/map-analysis/patternAnalysisJob.ts:155-168`, `apps/server/src/map-analysis/reworkDanJob.ts:140-151`, `apps/server/src/mania-rating/job.ts:230-247`, `apps/desktop/main.js:458`.

### G5. BMS tables background refresh can reject unhandled

Reopens F-062. Low, correctness, verified path, inferred trigger.

- **What:** `readSetting` and `writeSetting` sit outside the `try` in the fire-and-forget IIFE, and the `.finally` chain is never caught. A rejection such as SQLITE_BUSY after the 30 s timeout becomes an unhandled promise rejection.
- **Why:** Node exits on an unhandled rejection and the server has no handler, so opening the BMS tables tab could take the packaged app down. F-062 added no test for this route.
- **Fix:** Wrap the whole IIFE body in try/catch, or add `.catch(() => {})` before `.finally`, and add a route test with a throwing `readSetting`.
- **Evidence:** `apps/server/src/routes/bms.ts:85-97`, `:174-178`.

### G6. Hub callback redeems against the wrong Hub URL first

Reopens F-057. Low, correctness, verified.

- **What:** `useHubUrl()` returns `http://localhost:4322` until the status query resolves, and the callback page loads fresh, so the first render uses that default. The effect re-runs when `hubUrl` or `dict` change. The first run POSTs the handoff id and the secret verifier to `localhost:4322`.
- **Why:** With a non-default Hub, the verifier goes to whatever listens on localhost:4322, and the page flashes an error until navigation.
- **Fix:** Do not redeem until the status query has resolved, and guard the redeem with a ref so it runs once.
- **Evidence:** `apps/server/public/lib/hub.ts:44-51`, `:177-204`, `apps/server/public/features/hub/HubCallbackPage.tsx:17-32`.

### G7. Bundled BMS tables stamped with the local clock

Low, logic-gap, inferred.

- **What:** `seedBundledLocalTables` inserts bundled catalogues with `importedAt = Date.now()`, and `localTableCompletion` picks the greatest `importedAt`. A Hub version imported earlier never wins.
- **Fix:** Stamp bundled rows with a fixed snapshot time (or 0), or order by `(source = hub, importedAt)`.
- **Evidence:** `apps/server/src/bms/localProfile.ts:210-220`, `:252-258`, `apps/server/src/routes/bms.ts:75`.

## What happens next

- Phase 2 (fresh audit by area) was started but the first area agent was aborted. It still needs to be run.
- Phase 3 will re-open each candidate's evidence myself, drop anything that does not hold, and assign final `F2-NNN` ids.
- Phase 4 will write `findings2/README.md` and one note per confirmed finding. This file is the source for the regression table in that README.
