# Roxysu Hub (`apps/hub`) — in-depth issue analysis

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Default branch reviewed:** `master`  
**Commit:** `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`  
(“Update the docs site download links to v0.1.23.”, 2026-11-03 16:34 Europe/Lisbon)  
**Hub package version:** `0.1.1` (`apps/hub/package.json`)  
**Review date:** 2026-11-17  
**Clone used:** `/workspace/Roxysu` (read-only; this document lives outside the repo)

This document is a source review of the online Hub service in `apps/hub`, including its contract with `apps/server` and `apps/desktop`. Suggested patches are written to match the existing TypeScript / Elysia / Drizzle style. They are proposals only — nothing in the repo was modified.

---

## What was and was not verified

**Verified in source (this commit):** every issue below was re-read in the files cited. Small Bun/Node probes were also run on the review machine (not against a live Hub or osu!/Hinamizawa):

1. The in-memory rate limiter allows exactly `limit` hits then rejects (`30` allowed, `5` blocked in a 35-hit loop).
2. `createOAuthState` evicts the oldest entries once the store is over `MAX_ENTRIES` (5,000). After 5,002 creates, the first state was gone and a later one still consumed.
3. `statsObject` (used by `normalizeRankedBest`) drops judgement keys whose value is `0`. A payload with `miss: 0` is stored as `{ perfect, great, ok }` with **no `miss` key**.
4. `normalizeRankedBest` turns a missing `accuracy` field into `0`.
5. `aggregateCollectionStats` skips diffs with `stars <= 0`, and a mixed mania+osu sample can be labelled `dominantMode: "mania"` while `starsMax` comes from the osu!standard difficulty (tie-break is insertion order).

**Not verified (do not treat these as runtime measurements):**

- The packaged Hub image, Coolify deploy, Cloudflare edge, and `https://roxysu-api.yonx.app` were not reached.
- No live osu! OAuth or osu!api v2 session was opened. Budget parking, 429 `Retry-After` hangs, and the ranked-best page walk are control-flow findings.
- Hinamizawa was not called. Collection-create fan-out time is inferred from `FETCH_CONCURRENCY = 8`, `INFO_TIMEOUT_MS = 12_000`, and a 2,000-set cap, not a benchmark.
- SQLite `SQLITE_BUSY`, first-boot bundled-table seed time (~5,623 chart rows inserted one-by-one), and the 15s Docker `start_period` were not timed.
- Multi-replica behaviour of the in-memory OAuth / rate-limit / osu token stores was not exercised (compose is a single service).
- Content of a real calc-bundle or search-index dump was not measured; payload-size risk follows from “return every row” with a 100,000-set cap / unpaginated bundle download.
- Browser CORS from a non-loopback Workshop origin was not click-tested. Production compose pins `CORS_ORIGIN` to the two loopback Workshop origins.
- This is not a review of the Workshop React pages themselves, except where they define the Hub contract (`apps/server/public/lib/hub.ts`, `src/hubUrl.ts`, `src/bms/sync.ts`, `src/online-scores/pull.ts`, `src/mirrors/hubSearch.ts`, desktop OAuth redirect).

**Already in good shape in this commit (do not “re-fix”):**

- JWT secret fail-closed (weak/placeholder secrets rejected; production cannot use `HUB_ALLOW_INSECURE_JWT`).
- Production / published-port CORS refuse `*` or an unset allowlist.
- OAuth handoff is Hub-generated, one-time, and verifier-bound (PKCE-style). The JWT is never placed on the redirect URL. Desktop nonce and web `sessionStorage` verifier stay on the client.
- `requireAuth` re-reads role from the DB; `requireAdmin` is `.as("scoped")` so it is not skipped when the plugin is reused (covered by composition tests).
- Collection writes check `ownerId` (admins exempt). Online score pulls always use `user.osuId`, not a caller-supplied user id.
- `HUB_TRUST_PROXY` ignores forwarded headers unless set, and then prefers `X-Real-Ip` or the **last** `X-Forwarded-For` hop.
- BMS table import is admin-only, allowlisted, does not follow redirects, caps body size at 5MB, and has a 20s timeout.
- Inbound BMS scores derive EX / accuracy / DJ grade / combo lamp from judgements, reject autoplay, and cap a batch at 50 (Workshop sends 40).
- Drizzle/parameterized SQL on the collection and auth paths; leaderboard grade filters are interpolated from a fixed constant list.
- Search list pages are capped at 100; `/search` and `/search/all` are rate-limited; export is rate-limited.
- SQLite WAL + `foreign_keys = ON`; migrations abort process start on failure; compose has a `/health` check.

---

## Summary table

| ID | Severity | Title | Primary file | Effort |
|----|----------|-------|--------------|--------|
| H1 | High | `/osu/scores/best` has no inbound limit; one user can burn the shared osu! budget and hang the pull for minutes | `apps/hub/src/routes/osuScores.ts`, `services/osuScores.ts` | Medium (half day): route limit, request timeout, budget fairness |
| H2 | High | Collection create/update fans out up to 2,000 Hinamizawa fetches with no route limit or overall timeout | `apps/hub/src/services/collectionStats.ts`, `routes/collections.ts` | Medium (half day): cap, cache, rate-limit, bound the request |
| H3 | High | Unauthenticated dumps can be huge: `/search/all?fields=full` (up to 100k sets) and unpaginated `/calc-bundles/:version` (no rate limit) | `apps/hub/src/routes/search.ts`, `routes/calcBundles.ts` | Medium (half day): tighter caps, pagination, rate-limit the bundle GET |
| M4 | Medium | `/auth/login` is unrate-limited and can evict in-flight OAuth states (5,000-entry cap) | `apps/hub/src/services/oauthState.ts`, `routes/auth.ts` | Small (1–2 h) |
| M5 | Medium | Session JWT lasts 30 days with no server-side logout or revocation | `apps/hub/src/middleware/auth.ts` | Medium (policy + a denylist or shorter TTL + refresh) |
| M6 | Medium | `hub_users.username` is not unique; an osu! rename leaves stale rows that make `/api/bms/profiles/:username` ambiguous | `packages/db/src/hub/schema.ts`, `services/bms.ts` | Medium (half day) + a backfill |
| M7 | Medium | BMS leaderboards are self-reported; anyone can overwrite chart metadata; a new `installationId` re-inserts the same play | `apps/hub/src/services/bms.ts`, `bmsCommunity.ts` | Medium (policy + uniqueness + first-writer-wins metadata) |
| M8 | Medium | Collection list and favorites are N+1 (about five queries per card) | `apps/hub/src/routes/collections.ts` | Medium (half day): join or a batched loader |
| M9 | Medium | No `busy_timeout`, `replaceStored` is delete-then-insert outside a transaction, and there is no graceful shutdown | `apps/hub/src/db.ts`, `services/osuScores.ts`, `index.ts` | Small–medium (2–4 h) |
| M10 | Medium | Every boot full-scans BMS scores; first boot inserts ~5,623 bundled table rows one-by-one against a 15s healthcheck `start_period` | `apps/hub/src/index.ts`, `services/bms.ts`, `docker-compose.yml` | Small–medium |
| M11 | Medium | Mania data quality: `miss: 0` is dropped, missing accuracy becomes `0%`, collection star range mixes rulesets | `apps/hub/src/services/osuScoreShape.ts`, `collectionStats.ts` | Small (1–2 h) + a Workshop check |
| M12 | Medium | OAuth states, handoffs, rate-limit buckets, and the osu! token/budget live only in process memory; outbound OAuth/token fetches have no timeout | `apps/hub/src/services/oauthState.ts`, `rateLimit.ts`, `osu-oauth.ts`, `osuScores.ts` | Medium (persist or document single-replica + add timeouts) |
| L1 | Low | A rejected BMS `localScoreId` can never be retried from that installation; `clearLampId` is always stored `null` | `apps/hub/src/services/bms.ts` | Small |
| L2 | Low | Invalid profile-score cursors are ignored; `GET /collections/:id/missing` is unused and has an unbounded `have` query | `apps/hub/src/services/bms.ts`, `routes/collections.ts` | Small |
| L3 | Low | The Hub image runs as root and defines no `USER` | `apps/hub/Dockerfile` | Small |
| L4 | Low | `optionalViewerUserId` does not check that the user still exists | `apps/hub/src/middleware/auth.ts` | Small; share the `requireAuth` lookup |
| L5 | Low | Validation errors return raw `error.message` | `apps/hub/src/index.ts` | Small |
| L6 | Low | Stale JSDoc on the web OAuth helper; tag constants otherwise match | `apps/server/public/lib/hub.ts` | Trivial |

---

## App structure

The Hub is the public, shared service in front of Roxysu. The local Workshop (`apps/server` on `127.0.0.1:4321`) and the Electron shell (`apps/desktop`) talk to it for osu! OAuth login, shared collections, the Download Maps search index, calc-bundles (precomputed mania difficulty / skill), online ranked-best pulls, and community BMS scores.

```
osu! OAuth (identify)          osu!api v2 (client_credentials, scope=public)
        |                                    |
        +-----------------+------------------+
                          |
                   apps/hub  (Bun + Elysia, port 4322)
                          |
              SQLite  (DATABASE_URL, WAL)
                          |
    apps/server (Workshop)  /  apps/desktop (system-browser OAuth)
                          |
              Hinamizawa mirror (search primes + collection stats)
```

| Piece | Role |
|-------|------|
| `apps/hub/src/index.ts` | Boot: JWT/CORS fail-closed, migrations, cache rehash, BMS seed/recompute, cron, `/health` |
| `apps/hub/src/middleware/auth.ts` | JWT plugin (`exp: "30d"`), `requireAuth`, `requireAdmin`, optional viewer |
| `apps/hub/src/routes/auth.ts` | `/auth/login`, `/auth/callback`, `POST /auth/handoff/:id`, `/auth/me` |
| `apps/hub/src/routes/collections.ts` | Public browse/export; authenticated create/update/delete/favorite |
| `apps/hub/src/routes/search.ts` | `GET /search`, `GET /search/all` against admin-primed index |
| `apps/hub/src/routes/admin.ts` | Search-cache primes + calc-bundle upload (admin) |
| `apps/hub/src/routes/calcBundles.ts` | Public download of a versioned calc bundle |
| `apps/hub/src/routes/osuScores.ts` | `GET /osu/scores/best`, `/osu/scores/progress`; admin budget |
| `apps/hub/src/routes/bms.ts` | Authenticated ingest + public profiles/leaderboards/feed/stats |
| `packages/db/src/hub/schema.ts` | SQLite schema (users, collections, search index, calc bundles, osu pulls, BMS) |
| `apps/hub/drizzle/*.sql` | Hub’s own migrations (separate from `packages/db/drizzle`) |
| Deploy | `apps/hub/Dockerfile` + `docker-compose.yml` (Coolify). Image `publier.yonx.app/roxysu/hub:latest`. Volume `/app/data`. `HUB_ENV=production`, `HUB_TRUST_PROXY=1`, CORS pinned to `http://127.0.0.1:4321,http://localhost:4321` |

**Client contract** (checked against this commit; paths line up unless noted in L6 / L2):

| Client | Hub it calls |
|--------|----------------|
| `apps/server/src/hubUrl.ts` | Default `http://localhost:4322`; Electron (`ROXYSU_DESKTOP=1`) uses hardcoded `https://roxysu-api.yonx.app` |
| `public/lib/hub.ts` | `/auth/login`, `POST /auth/handoff/:id`, `/auth/me`, `/collections*`, `/admin/cache*`, `/admin/calc-bundles*` |
| `src/routes/system.ts` | Desktop complete/pending: redeems `POST {hub}/auth/handoff/:id` with the client verifier |
| `src/mirrors/hubSearch.ts` | `GET /search`, `GET /search/all` (8s / 20s timeouts, circuit breaker) |
| `src/online-scores/pull.ts` | `GET /osu/scores/best?ruleset=&force=` (Bearer JWT; **no timeout** on this fetch) |
| `src/bms/sync.ts` | `POST /api/bms/scores/batch` in batches of 40 (`MAX_BATCH` on Hub is 50) |
| `src/map-analysis/calcBundle.ts` | `GET /calc-bundles/:version`, admin upload to `/admin/calc-bundles` |
| Tag constants in `public/lib/hub.ts` | Match `HUB_MODE_TAGS` / `HUB_TAG_GROUPS_BY_MODE` / `HUB_TAGS_BY_MODE` in the schema. `LEGACY_HUB_TAGS` exist only on the Hub (intentional). |

Auth flow in short: Workshop or desktop builds a SHA-256 challenge and opens `{hub}/auth/login?challenge=…` (desktop also sends `client=desktop&nonce=…`). Hub redirects to osu! with a one-time `state`. `/auth/callback` upserts the user, signs a 30-day JWT, stores it under a Hub-generated handoff id, and redirects to `http://127.0.0.1:4321/#/hub-callback?h=…` or `/api/system/hub-oauth/complete?h=…&n=…`. Only the client that holds the verifier can `POST /auth/handoff/:id`. The JWT is then kept in Workshop `localStorage` (`roxysu:hub-jwt`).

---

## Recommended fix order

Land availability and “login stops working” items first. Several share the existing `allowRateLimit` / `clientIp` helpers.

1. **H1** — inbound rate limit and a request timeout/deadline on `/osu/scores/best`; don’t let `force=1` starve the shared osu! budget. This is the only path that can park every user’s online-score pull.
2. **H2 + M4 (collection writes)** — rate-limit collection create/update, cap how many Hinamizawa calls one request may start, cache set metadata, and add an overall timeout so one share cannot stall the process.
3. **M4 (login)** — rate-limit `GET /auth/login` so a stranger cannot evict in-flight OAuth states. Cheap and unblocks H1/H2 work on the same helper.
4. **H3** — paginate or incrementally stream calc-bundles; lower or chunk `/search/all?fields=full`; rate-limit the bundle GET.
5. **M12** — timeouts on `exchangeCode` / `clientToken` / `osuGet`; decide that Hub stays single-replica, or persist OAuth/rate-limit state. Complements H1 and M4.
6. **M9** — `PRAGMA busy_timeout`, transactional `replaceStored`, SIGTERM drain. Small and prevents “restart during a pull” data loss.
7. **M11** — keep `miss: 0`, store `accuracy: null` when unknown, compute collection star range from the dominant mode (or per-mode stats). This is the main mania-data fix.
8. **M6** — unique username (case-insensitive) and/or profile lookup by `osuId`, plus a rename update path.
9. **M10** — skip BMS recompute when a schema/version flag says it is done; batch first-boot table inserts; raise `start_period`.
10. **M8** — batched collection list. UX under load, not a security fix.
11. **M5** — shorter JWT TTL and/or a revocation list (logout, “sign out everywhere”). Product policy.
12. **M7** — first-writer-wins (or admin) chart metadata; tighter uniqueness for the same play; keep the `community_submitted` label visible in every leaderboard UI.
13. **L1–L6** — rejected-id retry, cursor consistency, non-root image, optional-viewer DB check, quieter validation errors, comment cleanup.

Suggested grouping if you want fewer PRs: (H1+M12 timeouts), (H2+M4), (H3), (M9+M10), (M11), (M6), (M8), (M5), (M7), (L*).

---

## H1 — `/osu/scores/best` has no inbound limit; one user can burn the shared osu! budget and hang the pull for minutes

**Severity:** High (availability of a shared dependency + hanging requests)

### Where

The route is authenticated, but it has no inbound rate limit, no request deadline, and `force=1` bypasses the 24-hour freshness window. Every caller shares one process-wide osu! budget (50 calls/minute, 4 in flight). A 429 parks **all** outbound osu! traffic.

```18:40:apps/hub/src/routes/osuScores.ts
export const osuScoreRoutes = new Elysia({ prefix: "/osu" })
  .use(requireAuth)
  .get(
    "/scores/best",
    async ({ user, query }) => {
      const ruleset = rulesetOr400(query.ruleset);
      if (typeof ruleset !== "string") return ruleset;
      const scores = await pullRankedBests(
        user.osuId,
        ruleset,
        query.force === "1",
      );
      return {
        osuId: user.osuId,
        // ...
        scores: scores.scores,
        budget: scores.budget,
      };
    },
    { query: rulesetQuery },
  )
```

The crawler walks pages of 100, **four at a time**, and retries a 429 up to six times, sleeping `Retry-After` (default 60s) between attempts:

```187:200:apps/hub/src/services/osuScores.ts
  let res = await osuGet(path);
  for (let attempt = 0; res.status === 429 && attempt < 6; attempt++) {
    const retry = Number(res.headers.get("retry-after") ?? "60");
    await new Promise((resolve) =>
      setTimeout(resolve, (Number.isFinite(retry) ? retry : 60) * 1000),
    );
    res = await osuGet(path);
  }
```

```331:335:apps/hub/src/services/osuScores.ts
    const offsets = [0, 1, 2, 3].map((i) => offset + i * RANKED_BEST_PAGE);
    const pagesBatch = await Promise.all(
      offsets.map((pageOffset) => fetchBestPage(osuUserId, ruleset, pageOffset)),
    );
```

`acquireOsuSlot` also waits in a loop with no timeout while the process is parked. `osuGet` / `clientToken` themselves have no `AbortSignal.timeout`. A “fresh” cached pull still fetches page 0 every time to compare `topScoreId`.

The Workshop client in `apps/server/src/online-scores/pull.ts` calls this endpoint with the user’s Hub JWT and **no fetch timeout**.

**Already good:** pulls are keyed by `osuUserId:ruleset` (`createKeyedFlights`), so two overlapping clicks share one crawl. The caller can only pull **their own** `user.osuId` (no IDOR). The budget is seeded from the SQLite ledger so a restart cannot immediately spend another minute.

### What happens and why

1. User A (or a script with a valid JWT) hits `GET /osu/scores/best?ruleset=mania&force=1`.
2. `runPullRankedBests` sets status `running` and starts `walkPages`. Each page takes a slot from the shared 50/min budget.
3. A user with many ranked bests (the API no longer hard-caps at 100) can require tens of pages. Four pages in parallel burn budget quickly. If osu! returns 429, that call can sleep for up to ~6×60s **and** `markOsuParked` blocks every other pull.
4. The HTTP request stays open until the crawl finishes, errors, or the client disconnects (the Hub does not abort on disconnect).
5. User B’s later “refresh my scores” call queues behind the park window / slot wait, or fails with `osu! rate limit`.

Root cause: outbound protection (`OSU_MAX_PER_MINUTE`, park ledger) is not matched by inbound protection or a per-request deadline. `force=1` is a useful escape hatch that is also an unbounded “spend budget now” button.

**Not runtime-verified:** a live 429 from osu!, or how many ranked bests a heavy mania account actually has under `x-api-version: 20220705`. The hang follows from the retry loop and `acquireOsuSlot`; the shared-budget part is explicit in the code.

### Impact

- **Availability:** one authenticated user can degrade or pause online-score pulls for everyone on that Hub, including other mania players waiting on a ranked-best refresh.
- **Reliability:** a single request can occupy the event loop’s open connections and in-flight slots for several minutes. `replaceStored` (see M9) then runs after a long walk.
- **Client:** the Workshop pull has no timeout, so the UI can sit on “loading” for the same period.
- **Security:** this is not RCE or IDOR; it is an authenticated denial-of-service against a shared third-party quota.

### Repro

1. Sign in to Hub, obtain a JWT.
2. From two accounts (or one account and a second ruleset), send `GET /osu/scores/best?ruleset=mania&force=1` and immediately `GET /osu/scores/best?ruleset=osu&force=1` on another user.
3. Observe `pagesFetched` / `budget.callsThisMinute` via `GET /osu/scores/progress` and `GET /admin/osu-budget`. After a 429 (or after 50 calls), the second pull waits or errors.
4. Optionally hold `https://osu.ppy.sh/api/v2` in a test double that always returns 429 with `Retry-After: 60` and watch the first request stay open for minutes.

### Proposed patch

- Rate-limit the route per user **and** per IP, e.g. `allowRateLimit(\`osu-best:${user.sub}\`, { limit: 2, windowMs: 60_000 })` and a slightly higher IP cap. Return 429 instead of starting another crawl.
- Give the whole pull a deadline (e.g. 20–30s for a cache-fresh top-score check, 2–3 minutes for a full crawl). Pass an `AbortSignal` into `osuGet` / `fetchBestPage` and stop `walkPages` when it fires. Return `202` + progress if the crawl must continue in the background (the progress endpoint already exists).
- Treat `force=1` as “skip the top-score short-circuit” but still subject to the same inbound limit and to a reserve of budget (e.g. force may not run if `callsThisMinute` is already over half the cap).
- Add `AbortSignal.timeout` to `clientToken` and `osuGet` (see M12). Consider having the Workshop pull use a timeout too, so a hung Hub cannot hang the local app indefinitely.

### Trade-offs

Background crawls mean the GET can no longer always return the full list in one shot; the Workshop already has a progress endpoint and a freshness window, so this is a natural split. A tight inbound limit will annoy someone who switches rulesets quickly — allow a small burst per user (mania + one other mode) rather than a global “one pull per minute”.

### How to test

- Unit-test a wrapper around `runPullRankedBests` with a fake `osuGet`: 429 with `Retry-After: 1` must not loop past the request deadline.
- Integration: two JWTs, first call holds a fake slow API; second must get 429/202 rather than wait for the first to finish spending the budget.
- Confirm a cache-fresh request still does at most one page-0 check, and that `force=1` is rejected when the user is already over their inbound cap.

---

## H2 — Collection create/update fans out up to 2,000 Hinamizawa fetches with no route limit or overall timeout

**Severity:** High (authenticated availability; third-party amplification)

### Where

`POST /collections` and `PUT /collections/:id` accept up to 2,000 beatmapset ids and then call `computeCollectionStatsFromSetIds` **before** the transaction. There is no `allowRateLimit` on these routes (only `GET /:id/export` is limited).

```525:528:apps/hub/src/routes/collections.ts
      const stats = await computeCollectionStatsFromSetIds(
        maps.beatmapsetIds,
        diffs?.beatmaps.map((row) => row.beatmapId),
      );
```

```167:209:apps/hub/src/services/collectionStats.ts
async function fetchHinaiSetDiffs(
  setId: number,
  allowedBeatmapIds?: Set<number>,
): Promise<DiffSample[]> {
  // fetch https://mirror.hinamizawa.ai/v3/osu/beatmaps/s/${setId}
  // signal: AbortSignal.timeout(12_000)
  // errors → []
}

export async function computeCollectionStatsFromSetIds(...) {
  // unique set ids, then:
  for (const batch of chunk(unique, FETCH_CONCURRENCY * 2)) {
    const parts = await mapPool(batch, FETCH_CONCURRENCY, (setId) =>
      fetchHinaiSetDiffs(setId, allowed),
    );
    // ...
  }
}
```

`FETCH_CONCURRENCY` is 8. The body schema allows `beatmapsetIds` `maxItems: 2000` and `beatmaps` `maxItems: 10_000`. Failed fetches are swallowed (`return []`), so a timeout storm still holds the request for up to `ceil(2000/8) * 12s` in the worst case (on the order of **40 minutes**), then writes a collection whose stats are all `null` (see also M11).

### What happens and why

1. Any signed-in user posts a collection of 2,000 (even bogus) set ids.
2. The Hub opens eight concurrent requests to Hinamizawa and keeps going until every id has been attempted.
3. Nothing cancels the work if the client disconnects, and nothing stops a second create from starting at the same time.
4. The Elysia process spends minutes on outbound I/O; the collection list (M8) and search cron also need the same event loop and SQLite writer.
5. On total failure, the collection is still created with `starsMin/Max` and `dominantMode/Keys` null, so it will not match mania / key / star filters.

Root cause: stats are computed synchronously and live, with a per-fetch timeout but no budget for the request as a whole, and no inbound cap on how often a user may trigger that work.

**Not runtime-verified:** actual Hinamizawa latency or rate limits. The upper bound follows from the published constants and the empty `catch`.

### Impact

- **Availability:** one Workshop user can stall the public Hub and hammer a third-party mirror. This is worse in production than locally because every desktop client shares one Hub.
- **Product:** a share that “succeeds” may still be invisible in the mania / 7K / star filters mania players actually use.
- **Cost / abuse:** 2,000 GETs × many creates is a straightforward amplification.

### Repro

1. Authenticate, then `POST /collections` with `beatmapsetIds: [1, 2, …, 2000]` and a valid tag list.
2. Watch outbound connections to `mirror.hinamizawa.ai`. The request should remain open far longer than a normal share.
3. A parallel `GET /collections` or `GET /health` may still answer (Node will accept connections) but will compete for the same process; a second fat POST will overlap.
4. When the first POST finally returns, `GET /collections/:id` shows null `starsMin` / `dominantMode` if the ids were invalid or the mirror timed out.

### Proposed patch

- Rate-limit create/update per user (e.g. 5/min) and reject a second stats job for that user while one is running (`createSingleFlight` already exists).
- Lower the first-request cap (e.g. 200 sets unless stats are already known) or compute stats asynchronously: create the collection immediately with `statsStatus: "pending"`, fill stars/mode/keys in a worker, and have the Workshop poll or refresh.
- Cache Hinamizawa set metadata in SQLite (set id → diffs) so a popular map is not refetched for every share.
- Add an overall `AbortSignal` (e.g. 10s) around `computeCollectionStatsFromSetIds`. If time runs out, store null stats and queue a retry rather than looping for the rest of the hour.
- Consider the same inbound limit on any other route that calls Hinamizawa (admin cache refresh is admin-only and already single-flight; leave it, but don’t start a user-facing 2,000-fetch job).

### Trade-offs

Async stats mean a just-shared collection can briefly appear without filters. That’s better than a 40-minute POST and matches how the search cache already works (prime now, read later). Caching set metadata can go stale when a map is updated; a 24h TTL (the search-cache default) is enough for star/key aggregates.

### How to test

- Unit-test `computeCollectionStatsFromSetIds` with a fake `fetch` that never resolves before 12s: with an overall 10s deadline it must return, not wait for all ids.
- Route test: a 6th create in a minute returns 429; a 2,001st set id still 400s from the schema.
- After a forced timeout, the collection row exists and a later worker/retry fills `dominantMode`.

---

## H3 — Unauthenticated dumps can be huge: `/search/all?fields=full` and unpaginated `/calc-bundles/:version`

**Severity:** High (memory / event-loop availability on a public origin)

### Where

`GET /search/all` is public. `fields=full` returns every stub including embedded difficulties. `max` is allowed up to `SEARCH_ALL_MAX_SETS` (**100,000**). It is rate-limited to 10 requests / 60s / IP, and always sent as `Cache-Control: no-store` (so Cloudflare will not absorb the body).

```7:7:apps/hub/src/services/searchIndex.ts
export const SEARCH_ALL_MAX_SETS = 100_000;
```

```181:201:apps/hub/src/routes/search.ts
      const dump = await querySearchIndexAll(db, row.id, secondary, {
        fields: fields === "ids" ? "ids" : fields === "full" ? "full" : "compact",
        maxSets: max,
      });
      // ...
      return {
        cached: true,
        // ...
        beatmapsets:
          fields === "full"
            ? dump.stubs
            : fields === "ids"
              ? []
              : dump.sets,
      };
```

`GET /calc-bundles/:version` is also public, has **no rate limit**, and loads every entry for that version in one JSON response. Uploads may be appended in chunks of 2,000; there is no cap on total rows in a version.

```29:43:apps/hub/src/routes/calcBundles.ts
    "/:version",
    async ({ params, set }) => {
      // ...
      const entries = await listCalcBundleEntries(row.id);
      set.headers["Cache-Control"] = "no-store";
      return {
        ...serializeBundleMeta(row),
        entries: entries.map(serializeEntry),
      };
    },
```

The Workshop client (`src/mirrors/hubSearch.ts`, `src/map-analysis/calcBundle.ts`) depends on these shapes; it already uses a 20s timeout for `/search/all`.

### What happens and why

1. Anyone who can reach the production Hub can request a full search dump or a whole calc-bundle.
2. The Hub reads the rows from SQLite, builds a large object graph, and JSON-serializes it on the same Bun process that serves login, collections, and score pulls.
3. A few concurrent `fields=full&max=100000` requests, or one large mania calc-bundle (two algorithms × tens of thousands of hashes, each with skill/density columns), can spike memory and delay every other route.
4. `/search/all` at least has an IP limit. `/calc-bundles/:version` does not, and `no-store` means the edge will not cache a successful response either.

Root cause: both endpoints were designed as “give the local app everything in one shot,” without a hard memory budget or pagination on the download path.

**Not runtime-verified:** megabytes for a real prime or a real `0.1.23` bundle. The risk is the missing cap, not a measured OOM.

### Impact

- **Availability:** a short unauthenticated script can slow or kill the public Hub that every desktop client uses for login and collections.
- **Product:** Download Maps and calc-bundle fill then fall back or fail (the search client already has a circuit breaker; calc-bundle fill would error).
- **Bandwidth:** `no-store` on a 100k-set payload means every client pays and the origin pays, every time.

### Repro

1. Against a Hub that has a primed ranked-mania cache, `GET /search/all?mode=3&status=ranked&fields=full&max=100000` and watch RSS / response size.
2. Repeat from a handful of IPs (or one IP at 10/min) while hitting `/health` and `/auth/me`.
3. `GET /calc-bundles/0.1.23` (or whatever version was uploaded) in a tight loop — there is no 429.

### Proposed patch

- Default `/search/all` to `fields=ids` or `compact`. Require auth or an admin token for `fields=full`, or cap `max` much lower for `full` (e.g. 2,000) and offer a cursor.
- Paginate `GET /calc-bundles/:version` (`?after=&limit=`) and keep `/meta` for the entry count. Teach the Workshop client to walk pages (it already uploads in chunks of 2,000). Until the client is updated, you can keep a compatibility path behind a tight rate limit and a size cap.
- Rate-limit `GET /calc-bundles/*` per IP (similar to `/search/all`).
- Optionally allow a short CDN TTL for immutable versioned bundles (`Cache-Control: public, max-age=…` on a content hash or frozen version), so repeats do not hit SQLite.

### Trade-offs

The local app wants a simple “get the whole bundle” call on first launch. Pagination adds a few round trips but matches the upload API you already have. If you must keep a single-shot GET, cap it with a 413 when `entryCount` exceeds a safe threshold and tell the client to use the paged API.

### How to test

- Route tests: `fields=full&max=100000` without auth returns 401/403 or is clamped; `fields=compact` still works for Download Maps.
- A stub bundle of N entries is returned in pages of 2,000; the Workshop fill helper concatenates them to the same in-memory shape as today.
- Burst GET on `/calc-bundles/:version` returns 429 after the cap.

---

## M4 — `/auth/login` is unrate-limited and can evict in-flight OAuth states

**Severity:** Medium (availability of login; related write routes are also unlimited)

### Where

`GET /auth/login` always inserts a new in-memory OAuth `state` (10-minute TTL, `MAX_ENTRIES = 5_000`). The only Hub rate limit on `/auth` is on `POST /auth/handoff/:id` (30/min/IP). Collection create/update, BMS ingest, and `/osu/scores/best` also have no inbound limit (H1/H2).

```31:44:apps/hub/src/services/oauthState.ts
function pruneMap<T extends { expiresAt: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [key, value] of map) {
    if (value.expiresAt <= now) map.delete(key);
  }
  if (map.size <= MAX_ENTRIES) return;
  // Drop oldest-ish by iterating insertion order.
  const overflow = map.size - MAX_ENTRIES;
  let i = 0;
  for (const key of map.keys()) {
    map.delete(key);
    i += 1;
    if (i >= overflow) break;
  }
}
```

A Bun probe in this review created 5,002 states: the first `consumeOAuthState` returned `null`, a later one still worked.

### What happens and why

1. An attacker (no account needed) hits `GET /auth/login?challenge=<43-char base64url>` in a loop. Each hit is a 302 to osu! and a new Map entry.
2. Once more than 5,000 states are live, `pruneMap` deletes the oldest, including states that real users are still completing in the osu! tab.
3. The user’s `/auth/callback?state=…` then returns `400 Invalid or expired OAuth state`. They have to start over — and may be evicted again.

The same in-memory Map is used for handoffs (5-minute TTL, same cap). Handoff *redeem* is rate-limited; *creation* is not, but creation only happens after a successful callback, so login-state eviction is the easier attack.

### Impact

- **Login:** a low-effort unauthenticated flood can make Hub sign-in fail for everyone until the flood stops and new states survive 10 minutes.
- **Memory:** 5,000 small entries are not a memory bomb; the harm is eviction, not RSS.
- **Related:** the same missing inbound limits on create/BMS/osu pulls are covered in H1/H2; this issue is the login-specific one.

### Repro

1. From a script, request `/auth/login?challenge=` + a valid 43-char base64url SHA-256, 5,100 times (follow redirects off).
2. In another browser, start a real login just before the script finishes.
3. Complete osu! authorization. The callback should 400 if that state was evicted.

Or, in a unit test: `createOAuthState` 5,001 times after a “victim” state and assert `consumeOAuthState(victim)` is null. Already demonstrated in this review’s probe.

### Proposed patch

- Rate-limit `GET /auth/login` per IP (e.g. 10/min, 30/hour). Return 429 rather than creating a state.
- Optionally require the challenge *and* a short-lived cookie/token from a prior “intent” POST if you ever see login DoS in production; the IP limit is enough for now.
- When evicting, prefer expired entries (already done) and consider not evicting the newest N, or refusing new states with 503 when the map is full instead of dropping in-flight logins.
- Apply `allowRateLimit` to BMS batch and collection writes at the same time (even if H1/H2 land later).

### Trade-offs

A NAT or shared Workshop IP (all `127.0.0.1` if Hub is reached without `X-Real-Ip` — see M12) will share the login budget. For the production compose setup, Coolify should forward the client IP; document that `HUB_TRUST_PROXY=1` requires `X-Real-Ip` or a correct last `X-Forwarded-For` hop. If the proxy IP is all you see, every user shares one bucket — still better than unlimited eviction, but you may need a higher cap.

### How to test

- Extend `auth.handoff.test.ts` / `security.test.ts`: 11th login from one IP in a minute is 429 and does not call `createOAuthState`.
- Keep the overflow unit test, but after the patch a full map should reject rather than evict a live state (or evict only expired ones).

---

## M5 — Session JWT lasts 30 days with no server-side logout or revocation

**Severity:** Medium (stolen-token window)

### Where

```42:48:apps/hub/src/middleware/auth.ts
export const jwtPlugin = new Elysia({ name: "jwt" }).use(
  jwt({
    name: "jwt",
    secret: resolveJwtSecret(),
    exp: "30d",
  }),
);
```

There is no `/auth/logout`, no token `jti` denylist, and no “issued after password/osu revoke” check. `requireAuth` only verifies the signature, expiry, and that `claims.sub` still exists. The Workshop stores the token in **`localStorage`** (`roxysu:hub-jwt` in `apps/server/public/lib/hub.ts`). Clearing it is the only “logout.”

Role is correctly re-read from the DB (an admin demotion takes effect). A **deleted** user fails `requireAuth`, but `optionalViewerUserId` (L4) does not do that lookup.

### What happens and why

1. A JWT is issued at `/auth/callback` and redeemed once via the handoff.
2. Anyone who later copies that token (XSS in the local UI, a leaked log, a shared screenshot of devtools, a disk copy of `localStorage`) can call every authenticated Hub route as that user for up to 30 days: share/delete collections, upload BMS scores, trigger score pulls (H1), etc.
3. “Log out” in the Workshop only deletes the local copy. The Hub will still accept the old token.

This is a common SPA pattern, not a unique footgun, but 30 days is a long life for a bearer token that authorizes writes on a public origin.

### Impact

- **Account:** a leaked token is a full session. BMS ingest and collection edits are the practical harm.
- **Admin:** an admin JWT is correspondingly more serious (cache primes, calc-bundle replace, table import).
- Combined with M7, a stolen token can also publish fake BMS scores under that osu! name.

### Repro

1. Sign in, copy the Bearer token from `localStorage`.
2. In the UI, log out (`clearHubJwt`).
3. `GET /auth/me` and `POST /api/bms/scores/batch` with the copied token still succeed until `exp`.

### Proposed patch

- Shorten `exp` (e.g. 12h or 7d) and add a refresh path, **or** keep 30d but put a `jti` (or `iat`) in the token and store a server-side revoke list / `tokenValidAfter` column on `hub_users`.
- Add `POST /auth/logout` (revoke this jti) and `POST /auth/logout-all` (bump `tokenValidAfter`). Have the Workshop call logout on sign-out, not only `clearHubJwt`.
- Reject tokens in `optionalViewerUserId` with the same checks as `requireAuth` (L4).

### Trade-offs

Shorter TTL means more frequent OAuth for desktop users who open the app weekly. A `tokenValidAfter` bump is simpler than a growing denylist and is enough for “sign out everywhere” and user deletion.

### How to test

- Sign, bump `tokenValidAfter`, assert `/auth/me` is 401.
- Logout revokes the jti; a second request 401s; a new login works.
- Existing 30d tokens must be migrated or accepted until their `exp` if you don’t want to kick everyone on deploy — document the cutover.

---

## M6 — `hub_users.username` is not unique; an osu! rename leaves stale profile URLs

**Severity:** Medium (wrong BMS profile / possible mix-up after a rename)

### Where

The schema uniquely indexes `osu_id` only:

```7:11:packages/db/src/hub/schema.ts
export const hubUsers = sqliteTable("hub_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  osuId: integer("osu_id").notNull().unique(),
  username: text("username").notNull(),
```

Login updates `username` on the row that matches `osuId`. Profile reads look up by case-insensitive name and take **one** row:

```315:320:apps/hub/src/services/bms.ts
async function userByName(db: HubDb, username: string) {
  return db
    .select()
    .from(hubUsers)
    .where(sql`lower(${hubUsers.username}) = ${username.toLowerCase()}`)
    .get();
}
```

The same helper is used in `bmsCommunity.ts`.

### What happens and why

osu! usernames can be recycled. Sequence:

1. Player A is on the Hub as `foo`.
2. A renames to `bar` on osu! but does not open Roxysu again. The Hub row is still `foo`.
3. Player B, now actually named `foo`, signs in. Hub inserts/updates B as `foo`. Two rows now share that username.
4. `GET /api/bms/profiles/foo` uses `.get()` with no `ORDER BY`. SQLite may return A or B. Leaderboards still show the stored `username` string, so two public profiles can also be indistinguishable in the feed.

Until A logs in again (and becomes `bar`), lookups are ambiguous. There is no unique index to prevent the second insert/update from completing.

### Impact

- **Mania / BMS community:** profile, compare, and table-completion URLs are name-based. The wrong player’s scores, or a 404 that hides a public profile, will confuse people.
- **Privacy:** if `.get()` returns the stale private/public row, one player’s visibility setting is applied to the name the other one currently uses. This is not a clean IDOR (ids are still distinct) but it is a real mix-up.
- Collections show `owner.username` from the join; those stay attached to `ownerId` and are fine.

### Repro

1. In a test DB, insert two `hub_users` with the same `username` and different `osu_id`.
2. `readBmsProfile(db, "foo", null)` several times (or inspect the SQL). The row you get is whichever SQLite returns first.
3. Or: create user A as `foo`, update A’s username in the DB only (simulating a rename that has not synced), log in as B named `foo`, then hit `/api/bms/profiles/foo`.

### Proposed patch

- Add a unique index on `lower(username)` (SQLite expression index) and, on login, rename the old holder of that name to a placeholder (`foo#<osuId>` or the last known name plus a suffix) if they have not been updated.
- Prefer profile URLs by `osuId` (`/api/bms/profiles/id/12345`) and keep the name as a redirect when it is unique.
- On lookup collision, prefer the row whose `username` was updated most recently (needs an `updatedAt` column) or return 409 with both `osuId`s rather than a silent pick.

### Trade-offs

Forcing a uniqueness backfill needs a policy for the stale row (placeholder name vs. delete). osuId-based URLs are stable but uglier; the Workshop can still display the current name.

### How to test

- A fixture with two `foo` rows must fail the new unique index, or the resolver must return a deterministic, documented choice.
- Login as B when A still holds `foo` must leave exactly one `foo` and a recoverable identity for A.
- Compare / leaderboard tests should not assume username uniqueness until the index exists.

---

## M7 — BMS leaderboards are self-reported; chart metadata can be overwritten; a new installation re-inserts the same play

**Severity:** Medium (integrity of community mania / BMS data)

### Where

The schema is explicit: `trust` defaults to `community_submitted`. Ingest is authenticated as “this osu! user claims this score,” not “a server replay-checked it.” Validation is internal consistency only (judgement math, ranges, no autoplay):

```205:271:apps/hub/src/services/bms.ts
  const reason = validateInbound(score);
  // ...
      await tx
        .insert(bmsCharts)
        .values({ /* md5, sha256, title, artist, keyCount */ })
        .onConflictDoUpdate({
          target: bmsCharts.md5,
          set: {
            ...(score.chart.sha256 ? { sha256: score.chart.sha256.toLowerCase() } : {}),
            ...(score.chart.title ? { title: score.chart.title } : {}),
            ...(score.chart.artist ? { artist: score.chart.artist } : {}),
            ...(score.chart.keyCount != null ? { keyCount: score.chart.keyCount } : {}),
            // ...
          },
        });
      await tx.insert(bmsScores).values({
        // ...
        trust: "community_submitted",
      });
```

Uniqueness is `(userId, installationId, localScoreId)`, not `(userId, chart, judgements, achievedAt)`:

```533:538:packages/db/src/hub/schema.ts
    sourceUnique: uniqueIndex("bms_scores_source_unique").on(
      t.userId,
      t.installationId,
      t.localScoreId,
    ),
```

Leaderboards correctly pick the best row **per user** (`ROW_NUMBER() … PARTITION BY s.user_id`) and hide private profiles, and they return `trust`. Profile **play counts**, the public feed, activity heatmaps, and global stats count **every** accepted row.

### What happens and why

1. **Fake scores:** a signed-in user can POST internally consistent judgements (e.g. a fabricated MAX) and appear at the top of a chart leaderboard. The `trust` field is there, but any UI that sorts only on EX / accuracy will treat it like a verified score.
2. **Chart poison:** the first or **later** submitter of an md5 can change `title`, `artist`, and `keyCount` for everyone. A 7K chart can be labelled 4K, or a well-known title can be replaced with junk.
3. **Play-count inflation:** if the Workshop’s `installationId` changes (reinstall, cleared settings, a second PC without the same id), the same `localScoreId` is a new unique key. The user can also invent installation ids. Leaderboards still show one best per user, but “plays,” feed, and 30-day active stats inflate.

`validateInbound` is doing the right job for a community table (reject autoplay, require pgreat/great, check EX and accuracy against counts). It cannot prove the play happened.

### Impact

- **Mania / BMS players:** community leaderboards, compare, and table completion can be wrong in a way that looks official.
- **Charts:** search and chart pages use the poisoned title/artist/keyCount for every player.
- **Stats:** `uniqueScores` / activity / feed become an installation-count metric, not a play metric.

### Repro

1. With a JWT, `POST /api/bms/scores/batch` with a real-looking 7K md5, consistent MAX judgements, and a title you chose. Open `/api/bms/charts/:md5/leaderboard?variant=…` — you are first, `trust` is `community_submitted`.
2. From a second account (or the same one), submit the same md5 with a different title and `keyCount: 4`. `GET /api/bms/charts/:md5` now shows the new metadata.
3. Resubmit the same `localScoreId` with a different `installationId`. Profile `plays` increases by one; the leaderboard still shows a single row for you.

### Proposed patch

- Keep the `trust` label and make it impossible to miss in every Workshop surface (leaderboard, feed, compare, chart page). If you later add replay or client-signed ingest, use a stricter trust enum rather than mixing the two.
- Chart metadata: first-writer-wins, or “only fill nulls,” or admin/table-import overwrites only. Do not let a later community score rename a chart that already has a title.
- Add a uniqueness rule for “same user, same chart, same variant, same `achievedAt` + EX” (or a hash of judgements) so a new installation id cannot create a second play. Keep `(user, installation, localScoreId)` as the idempotency key for the Workshop retry path.
- Optional: rate-limit BMS batch per user (also M4) and cap new charts per day.

### Trade-offs

First-writer-wins can lock in a typo; provide an admin edit or prefer titles from imported official tables when the md5 matches a table entry (those bundled tables already have titles). Tighter uniqueness may mark a real retry as a duplicate if the client changes installation id — treat that as `duplicate` with the existing `scoreId`, which is what the sync queue already understands.

### How to test

- Existing ingest tests plus: a second payload with a new title must leave the original title in place.
- Two batches that differ only by `installationId` and share chart/time/EX must yield one score (or one `duplicate`).
- Leaderboard fixtures should assert `trust` is present on every row.

---

## M8 — Collection list and favorites are N+1

**Severity:** Medium (performance under a modest catalogue)

### Where

`GET /collections` loads a page of ids (limit ≤ 100, default 20) and then calls `buildCollectionItem` per id. Favorites load **every** favorited id, with no pagination, and do the same.

```339:341:apps/hub/src/routes/collections.ts
      const items = await Promise.all(
        rows.map((row) => buildCollectionItem(row.id, viewerUserId)),
      );
```

`buildCollectionItem` itself does one collection+owner select, then in parallel: tags, map count, favorite count, “favorited by me,” and up to four preview set ids — **about five extra queries per card**, plus the first select.

Tag filtering (`collectionIdsMatchingAllTags`) also does one query per selected tag and intersects in JS, which is fine for a small tag set but is another N+1 pattern.

### What happens and why

A 20-item home page is on the order of 1 + 20×5 = 100+ SQLite statements, issued as many small prepared queries. With WAL this still works, but it competes with search-index reads, BMS leaderboards, and the cache cron on a single writer. Favorites get worse as a user stars more collections (unbounded).

### Impact

- **Latency:** Hub browse, the first screen mania players use to find shared packs, gets slower as the catalogue grows, even with indexes on `collection_id`.
- **Reliability:** lots of tiny writes/reads make `SQLITE_BUSY` more likely without `busy_timeout` (M9).

### Repro

1. Seed 20+ collections with tags, maps, and favorites.
2. `GET /collections?limit=20` while logging SQL (or wrapping `db`). Count statements.
3. Favorite 200 collections and `GET /collections/me/favorites`.

### Proposed patch

- One list query with joins / subselects for `map_count`, `favorite_count`, `favorited_by_me`, and `group_concat` tags, plus a single preview-id query `WHERE collection_id IN (…) AND rn <= 4`.
- Paginate favorites (`limit` / `page` or a cursor), same cap as the public list (100).
- For AND-tag filter, use a `GROUP BY collection_id HAVING count(*) = :n` instead of a loop of selects.

### Trade-offs

A single fat SQL statement is harder to read than `buildCollectionItem`. Keep the helper for the detail route and add a `buildCollectionItems(ids)` batch path used by list and favorites.

### How to test

- A unit test with 10 collections asserts the batch loader issues a bounded number of queries (e.g. ≤ 5 total), not O(n).
- Response JSON stays the same as `buildCollectionItem` (compare field-by-field in a fixture).

---

## M9 — No `busy_timeout`, `replaceStored` is not transactional, and there is no graceful shutdown

**Severity:** Medium (reliability / data loss on a single SQLite file)

### Where

```13:17:apps/hub/src/db.ts
const sqlite = new Database(dbPath, { create: true });

// Enable WAL mode for better concurrent read performance
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
```

There is no `PRAGMA busy_timeout`. Writers that collide (score-pull `replaceStored`, collection creates, cache refresh cron, BMS ingest, request-time search index) can fail immediately with `SQLITE_BUSY`.

`replaceStored` deletes all ranked bests for a user+ruleset and then inserts in chunks of 80, **outside** a transaction:

```274:298:apps/hub/src/services/osuScores.ts
async function replaceStored(...) {
  await db
    .delete(osuBestScores)
    .where(
      and(eq(osuBestScores.osuUserId, osuUserId), eq(osuBestScores.ruleset, ruleset)),
    );
  // then insert slices of 80, no transaction, no rollback on failure
}
```

`index.ts` never listens for `SIGTERM` / `SIGINT`. Coolify/Docker will send SIGTERM on deploy and then SIGKILL. In-flight transactions may complete (SQLite is durable once committed); a half-finished `replaceStored` will not.

### What happens and why

1. A ranked-best pull finishes walking pages and starts `replaceStored`.
2. The delete commits. The process is killed mid-insert, or a concurrent writer throws `SQLITE_BUSY` mid-chunk.
3. `GET /osu/scores/best` can then return a **partial or empty** list while `osu_score_pulls` may already have been updated to `done` (the `setProgress(… complete: true)` call is after `replaceStored` — good — but a crash *during* `replaceStored` after a previous `done` leaves stale progress and a truncated table).
4. Independently, without `busy_timeout`, a cache-cron refresh and a collection write can fail a request that would have succeeded after a 200–1000ms wait.

### Impact

- **Mania online scores:** a deploy or a busy Hub can wipe a user’s cached ranked bests until the next successful pull (which may itself be parked — H1).
- **Operational:** unexplained 500s under light concurrency that a one-line pragma would have absorbed.

### Repro

1. In a test, call `replaceStored` with a hook that throws after the first insert chunk. Assert the table is empty or short, and that `pulls.completeAt` is still the previous value (or not).
2. Open two connections and hold a write lock; without `busy_timeout` the second `INSERT` fails immediately.

### Proposed patch

```ts
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA busy_timeout = 5000;");
sqlite.exec("PRAGMA synchronous = NORMAL;");
```

- Wrap `replaceStored` in `db.transaction`. A failure or crash should leave the previous scores in place.
- On `SIGTERM`, stop the cron, refuse new long work (pulls, cache refresh, fat collection stats), wait a few seconds for in-flight transactions, then `process.exit`. Docker `stop_grace_period` should exceed that wait.

### Trade-offs

`synchronous = NORMAL` with WAL is the usual production default; stay on `FULL` if you prefer maximum durability over speed. A 5s busy timeout can make a request wait; that is better than a random 500.

### How to test

- Transaction test: inject a failure on chunk 2; the previous score set is still fully readable.
- Two writers with a 5s timeout: the second succeeds.
- Send SIGTERM during a fake long pull; the process exits after the transaction, not mid-delete.

---

## M10 — Every boot full-scans BMS scores; first boot inserts ~5,623 table rows one-by-one against a 15s healthcheck

**Severity:** Medium (startup / deploy reliability)

### Where

```22:27:apps/hub/src/index.ts
runMigrations();
await rehashSearchCacheKeys();
await migrateBlobsToRows();
await seedBundledBmsTables(db);
await recomputeStoredBmsScores(db);
```

`recomputeStoredBmsScores` `SELECT`s **every** `bms_scores` row and may `UPDATE` each one, every process start, with no “already current” flag.

`seedBundledBmsTables` is cheap on later boots if the version id already exists, but on first boot `storeTable` inserts each chart **in a loop** inside a transaction:

```829:845:apps/hub/src/services/bms.ts
      for (const entry of parsed.entries) {
        const chartHash = entry.md5 ?? entry.sha256;
        if (!chartHash) continue;
        await tx.insert(bmsTableEntries).values({ /* ... */ }).onConflictDoNothing();
      }
```

Bundled tables in this commit: insane 1,035, satellite 2,358, stella 2,230 charts (**5,623** inserts), from ~2MB of JSON. Compose healthcheck:

```39:49:apps/hub/docker-compose.yml
    healthcheck:
      # bun fetch http://127.0.0.1:4322/health
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 15s
```

The server does not listen until seed + recompute finish (`listen` is after the awaits). For 15 seconds the healthcheck is allowed to fail; after that, five failed 15s intervals can mark the container unhealthy during a slow first start or a large recompute.

**Not runtime-verified:** how long first boot actually takes on a Coolify volume. The healthcheck window and the per-row insert are in the source; duration is inferred.

### Impact

- **Deploys:** a first-time volume or a large BMS table can flap `unhealthy`, and Coolify may restart the container in a loop (seed restarts too, though the version short-circuit should eventually help).
- **Growth:** recompute is O(n) on every boot. It will only get slower as community scores accumulate.

### Repro

1. Empty `DATABASE_URL`, start the Hub, time “migrations applied” → “Running at http://…”.
2. Insert tens of thousands of BMS scores in a fixture, restart, and time `recomputeStoredBmsScores` alone.
3. Compare that to `start_period: 15s`.

### Proposed patch

- Record a schema/data version (e.g. `bms_score_grade_repair = 1`) and skip recompute when it is set. Keep a one-shot admin or CLI path for a future repair.
- Batch `bms_table_entries` inserts (you already chunk calc-bundles and `collectionBeatmaps` at 200–400).
- Raise `start_period` (e.g. 60–120s) so first boot can finish seeding.
- Optionally move seed/recompute to `db:migrate` / an entrypoint, and only then start the HTTP server.

### Trade-offs

Skipping recompute means a forgotten future repair will not auto-apply. That’s the right default; gate it on an explicit version bump in code when you need another pass.

### How to test

- Second boot with a pre-seeded DB must not insert table rows and must not walk scores if the flag is set.
- A micro-benchmark of 5,623-row batched insert vs the current loop, plus a healthcheck that stays green with `start_period` you choose.

---

## M11 — Mania data quality: `miss: 0` is dropped, missing accuracy becomes `0%`, collection star range mixes rulesets

**Severity:** Medium (wrong numbers for mania players — scores and collection filters)

### Where

Hub-normalized ranked bests go through `statsObject`, which **keeps only counts `> 0`**, then `lazerStatistics`:

```50:57:apps/hub/src/services/osuScoreShape.ts
function statsObject(value: unknown): Record<string, number> {
  // ...
    if (n != null && n > 0) out[key] = Math.trunc(n);
  return out;
}
```

```141:141:apps/hub/src/services/osuScoreShape.ts
    accuracy: num(row.accuracy) ?? 0,
```

A probe of `normalizeRankedBest` with `statistics: { perfect: 800, great: 20, miss: 0, ok: 3 }` stored `{ perfect, great, ok }` — **no `miss` key**. A payload with no `accuracy` field stored `accuracy: 0`.

Collection aggregates skip `stars <= 0` and then take min/max stars and dominant mode across **all** difficulties, with ties going to insertion order:

```97:114:apps/hub/src/services/collectionStats.ts
  for (const d of diffs) {
    if (!(d.stars > 0)) continue;
    starsMin = starsMin == null ? d.stars : Math.min(starsMin, d.stars);
    starsMax = starsMax == null ? d.stars : Math.max(starsMax, d.stars);
    modeCounts.set(d.mode, (modeCounts.get(d.mode) ?? 0) + 1);
    // keys only counted when mode === "mania"
  }
  // dominantMode = highest count; first wins a tie
```

A probe with one 5★ mania diff and one 6★ osu!standard diff produced `dominantMode: "mania"`, `dominantKeys: 7`, `starsMax: 6` (the osu! star). If Hinamizawa fails entirely (H2), all four stats stay `null` and the collection disappears from mode / key / star filters.

This sits next to the earlier Workshop logic review (lowercase judgement keys, accuracy / failed-play averages). The Hub is an additional place those keys can go missing before the local app ever sees them.

### What happens and why

1. An FC with zero misses is pulled from osu! and cached on the Hub. The Workshop later treats “no `miss` key” like “unknown,” so miss filters, graphs, or “FC vs miss” views can hide or mis-bin the play (depending on the client — **client behaviour was not re-run in this review**).
2. A best score whose API payload omits `accuracy` is stored as 0%, i.e. a broken play, and will sort or average as such.
3. A mixed-mode pack shared as “mania 7K 5–6★” can show a star range that is not the mania range, or (on a tie) be tagged mania while `starsMax` is a standard diff. Mania players browsing by stars then download the wrong idea of difficulty.

### Impact

- **Online score analysis:** judgement-sensitive views (misses, tight windows, “is this an FC”) can be wrong for otherwise clean plays.
- **Collection browse:** the mode / key / star filters mania players use on the Hub can disagree with the maps inside the pack.
- **Trust:** these are quiet data bugs; they do not 500, they just look like the player’s numbers.

### Repro

Already probed for (1) and (2). For (3):

- Call `aggregateCollectionStats([{ mode: "mania", stars: 5, keys: 7 }, { mode: "osu", stars: 6, keys: null }])` → `dominantMode === "mania"` and `starsMax === 6`.
- Share a mixed collection, then `GET /collections?q=mode=m stars>=6` and see it included because of the non-mania diff.

### Proposed patch

- In `statsObject`, keep any finite integer `>= 0` (or at least always keep `miss` / `perfect` / `great` / … when the key is present, including zero). Align stored keys with what the Workshop logic review expects (lowercase lazer names, zeros present).
- Store `accuracy: num(row.accuracy)` as `number | null`; do not default to 0. Have the client treat null as “unknown,” not 0%.
- For collection stats: compute `starsMin` / `starsMax` from diffs of `dominantMode` only (and mania keys from those diffs), **or** return per-mode ranges (`starsMinMania`, …). Do not let an osu!standard 7★ move a mania pack in the star filter. If no diffs survive, leave stats null and show that in the Workshop (pending / failed), rather than silently dropping the pack from filters.

### Trade-offs

Including zero-star or unranked diffs in mode counts may be undesirable; skipping `stars <= 0` for mode voting can stay. Per-mode ranges are more honest but need a small API addition (`starsMin` today is a single number). A client change is required if anything assumes accuracy is always a number.

### How to test

- Extend `osuScoreShape.test.ts` with `miss: 0` and missing accuracy (the cases this review probed).
- Extend `collectionStats.test.ts` with the mixed-mode fixture above; it should not report `starsMax: 6` for a mania-dominant pack unless you explicitly document “all-mode range.”
- After a pull, the Workshop miss filter should include a 0-miss FC.

---

## M12 — In-memory OAuth / rate limits / osu! token, and outbound OAuth fetches have no timeout

**Severity:** Medium (ops + hanging login)

### Where

These live only in the current process:

| Store | File | Survives restart? | Shared across replicas? |
|-------|------|-------------------|-------------------------|
| OAuth `state` + handoff JWT | `oauthState.ts` | No (10 min / 5 min TTL) | No |
| `allowRateLimit` buckets | `rateLimit.ts` | No | No |
| osu! client-credentials token | `osuScores.ts` `let token` | No (re-fetched) | No (would double spend) |
| In-process osu! budget + park | `osuBudget.ts` (ledger is in SQLite; the wait loop is not) | Seeded from DB | No |

`exchangeCode` and `fetchOsuMe` (`osu-oauth.ts`) and `clientToken` (`osuScores.ts`) use `fetch` **without** `AbortSignal.timeout`. Hinamizawa and BMS table import do set timeouts (12s / 15s / 20s).

Compose is a **single** `hub` service, so replica split-brain is not how it is deployed today. A rolling restart mid-login is.

If `HUB_TRUST_PROXY=1` but the proxy does not set `X-Real-Ip` / `X-Forwarded-For`, every client can share the proxy’s socket IP (or `"unidentified"`) and therefore one rate-limit bucket.

### What happens and why

1. A user is on the osu! authorize page. Coolify redeploys the Hub. The `state` is gone; callback 400s (same user-visible failure as M4, different cause).
2. osu! token endpoint or `/api/v2/me` hangs. `/auth/callback` waits indefinitely (Elysia will not finish, the browser spins).
3. Two Hub processes (an accidental scale-out, or a leftover container) would issue two client-credentials quotas and never see each other’s park window except via SQLite on a shared volume — and the in-memory slot counter would still be wrong.

### Impact

- **Login:** deploys drop in-flight OAuth; a hung osu! makes the callback hang (the Workshop web path also has no timeout on `redeemHubHandoff`).
- **Rate limits:** they reset on restart (weaker than they look) and do not apply globally if you ever run two processes.
- **Score pulls:** token refetch is fine; budget waits are not shared except for the park timestamp in SQLite.

### Repro

1. Start login, restart the Hub process, finish osu! — callback 400.
2. Point `OSU_TOKEN_URL` at a test server that never answers (or block the IP) and hit `/auth/callback` with a valid leftover state in a unit test; the request should still be open after 30s today.

### Proposed patch

- Add `AbortSignal.timeout` (e.g. 10–15s) to `exchangeCode`, `fetchOsuMe`, `clientToken`, and `osuGet`. Map timeout to the existing 502 messages.
- Document “single replica, sticky restarts will drop in-flight logins” in the compose file, **or** persist states/handoffs in SQLite with the same TTLs (a 5,000-row table, hashed keys).
- If you stay in-memory, that’s acceptable for v0.1 as long as login is rate-limited (M4) and timeouts exist.
- Confirm Coolify sets `X-Real-Ip` (or equivalent) so production rate limits are per client.

### Trade-offs

Persisting handoffs (which contain the JWT) means encrypting or storing a hash and only holding the JWT in memory, or encrypting at rest with `JWT_SECRET`. Timeouts alone are the high-value, low-risk part.

### How to test

- Unit-test `exchangeCode` against a hanging `fetch` mock; it must reject by 15s.
- Restart test: a state created before `clearOAuthStateStore()` (or process restart) must not redeem; after a SQLite persist patch, it must.

---

## L1 — A rejected BMS `localScoreId` can never be retried; `clearLampId` is always stored `null`

**Severity:** Low

### Where

If `validateInbound` fails, the Hub inserts a `bms_score_submissions` row with `status: "rejected"` and `onConflictDoNothing`. A later batch with the same `(user, installation, localScoreId)` hits:

```197:203:apps/hub/src/services/bms.ts
  if (prior?.status === "rejected") {
    return {
      localScoreId: score.localScoreId,
      status: "rejected",
      reason: "previously rejected",
    };
  }
```

before validation. A Workshop bug that sent a bad first payload (wrong accuracy, missing judgements) permanently blocks that local score, even after the client is fixed, unless `installationId` changes (which then hits M7).

Separately, ingest always writes `clearLampId: null` and derives `comboLampId` / `djGrade` from judgements. Table completion uses combo lamps and grades, so that path is fine, but anything that filters on clear lamp will see empty data. The inbound schema still accepts `clearLampId`.

### Impact

A player can be unable to publish a real score after a one-time client bug. Clear-lamp UI, if added, will look empty.

### Repro

POST a score with `accuracy` not matching judgements; it is rejected. POST the corrected payload with the same ids; it is still `previously rejected`.

### Proposed patch

Allow a retry when the new payload hashes differently and now passes `validateInbound`, or only persist `rejected` for policy reasons (autoplay), not for math errors. If you start storing clear lamps, derive them the same way as combo lamps rather than trusting the client, and stop advertising the field until then.

### Trade-offs

Letting math errors be retried is the right default; keep autoplay and other policy rejects permanent.

### How to test

Extend `bms.ingest.test.ts` with “first payload invalid, second valid, same localScoreId → accepted.”

---

## L2 — Invalid profile-score cursors are ignored; `GET /collections/:id/missing` is unused and unbounded

**Severity:** Low

### Where

`listProfileScores` parses `cursor` as `seconds|id`. If it is malformed, the extra filter is **skipped** and the first page is returned again — an infinite-scroll loop in a client that keeps sending a bad cursor. `bmsFeed` and `chartLeaderboard` correctly return `{ error: "invalid cursor" }`.

`GET /collections/:id/missing?have=` is public, not rate-limited, and accepts an arbitrary list of set ids. No Workshop or desktop caller references this route in this commit. Export already returns the full id list, so the client can diff locally.

### Impact

A buggy client can spin on the first page of a profile. The unused `missing` endpoint is a small DoS/odd-surface leftover (`have` can be a huge query string).

### Repro

`GET /api/bms/profiles/{name}/scores?cursor=nope` returns 200 and page 1. Repeat; same rows.

### Proposed patch

Return 400 on a bad cursor, like the feed. Remove `/missing` or rate-limit it and cap `have`. Prefer the export + local diff the Workshop already can do.

### Trade-offs

A 400 may break an old client that sent empty cursors; treat empty as “no cursor,” only reject malformed ones.

### How to test

One route test per handler for `cursor=nope` → 400, and `cursor` omitted → 200.

---

## L3 — The Hub image runs as root

**Severity:** Low

### Where

`apps/hub/Dockerfile` uses `oven/bun:1-slim`, creates `/app/data`, and `CMD ["bun", "run", "dist/index.js"]` with no `USER`. The compose volume is mounted at `/app/data`.

### Impact

A compromise of the Hub process is a compromise as root inside the container (still namespaced from the host, but worse than a dedicated uid). The SQLite file will also be owned by root, which slightly complicates a later non-root change.

### Repro

`docker run` the image and `ps` / `id` inside it — you will see uid 0 (not run in this review).

### Proposed patch

Create a `hub` user, `chown` `/app` and `/app/data`, and `USER hub`. On existing volumes, document a one-time `chown`. Bind `HUB_LISTEN` to the container network as you already do; this does not change the listen address.

### Trade-offs

Permission errors on an already-root volume are the only migration cost.

### How to test

Build the image, `docker run --rm … id` is not 0; `/health` still works with the volume mounted.

---

## L4 — `optionalViewerUserId` does not check that the user still exists

**Severity:** Low

### Where

```27:36:apps/hub/src/middleware/auth.ts
export async function optionalViewerUserId(...) {
  if (!bearer) return undefined;
  const payload = await jwt.verify(bearer);
  // ...
  return asJwtPayload(...)?.sub;
}
```

`requireAuth` loads the row and 401s if it is gone. Public BMS routes use the optional helper so a deleted (or not-yet-revoked, M5) token can still be treated as “the owner” of a now-deleted-or-stale `sub` for `visible()` checks. In practice `visible()` looks up the **profile** user, not the viewer row, so the main oddity is: a token for a deleted id never matches `viewerId === user.id` unless ids are reused (they are autoincrement; reuse is unlikely).

`asJwtPayload` also accepts any finite `Number(sub)` (including `1.5`). Tokens are signed by this server, so that is not attacker-controlled without `JWT_SECRET`.

### Impact

Very small today. It becomes more important if you add “private fields if I am the viewer” that trust `sub` without a DB row.

### Proposed patch

Reuse the same DB lookup as `requireAuth` (cache it per request). If the row is missing, treat the viewer as anonymous. Coerce `sub` with `Number.isSafeInteger` and `sub > 0`.

### Trade-offs

One extra lookup on public profile routes that already send a Bearer token — cheap.

### How to test

Mint a JWT for a non-existent `sub`, request a private profile: 404, not 200.

---

## L5 — Validation errors return raw `error.message`

**Severity:** Low

### Where

```59:62:apps/hub/src/index.ts
    if (code === "VALIDATION") {
      set.status = 400;
      return { message: "Validation error", details: error.message };
    }
```

Elysia / TypeBox messages can include schema internals (property paths, expected types). This is useful in development and mildly noisy in production (information about the request schema, not secrets).

### Impact

Low. No stack traces on the 500 path (`Internal server error` is already generic; the stack goes to `console.error` only).

### Proposed patch

In production (`isHubProduction()`), return `{ message: "Validation error" }` without `details`. Keep details when not published.

### Trade-offs

Harder to debug a 400 from a deployed Workshop; log the details server-side instead.

### How to test

`HUB_ENV=production`, POST `/auth/handoff/x` without a body: 400 and no TypeBox text in the JSON.

---

## L6 — Stale JSDoc on the web OAuth helper; the rest of the contract matches

**Severity:** Low (docs / hygiene; no behaviour bug found)

### Where

`apps/server/public/lib/hub.ts` `beginHubOAuthHandoff` is documented as if `handoff` and `challenge` both go in the Hub login URL. The Hub **ignores** a caller-supplied `handoff` query (intentionally, so a login link cannot pre-choose the redeem id). The actual `hubLoginUrl` helper only sends `challenge`, plus desktop `client` and `nonce`. `apps/server/src/routes/system.ts` comments describe the current flow correctly.

Otherwise the contract in this commit lines up:

- Paths: `/auth/*`, `/collections*`, `/search`, `/search/all`, `/calc-bundles/:version`, `/admin/*`, `/osu/scores/best`, `/api/bms/*`.
- Workshop BMS batch size 40 ≤ Hub `MAX_BATCH` 50.
- Tag groups in `hub.ts` match the schema (legacy tags exist only on the Hub).
- Search `limit` maximum 100 is also documented in `hubSearch.ts`.

Unused: `GET /collections/:id/missing` (L2). Hardcoded desktop Hub origin: `PRODUCTION_HUB_URL = "https://roxysu-api.yonx.app"` in `hubUrl.ts` — fine as long as DNS stays put; a rename would need a client update.

### Impact

A future change that puts `handoff=` back on the login URL would re-open a class of bugs the current code carefully closed. The stale comment makes that more likely.

### Repro

Read the JSDoc vs `hubLoginUrl` / `auth.ts` “A caller-supplied handoff is ignored.”

### Proposed patch

Update the JSDoc to match `system.ts`. Optionally add a contract test that `hubLoginUrl` never sets `handoff`.

### Trade-offs

None.

### How to test

A unit test on `hubLoginUrl(..., { challenge })` asserts the query keys are only `challenge` (and `client` / `nonce` when asked).

---

## Appendix — probes run in this review

```text
rate limit 30/60s: allowed 30, blocked 5
OAuth state overflow (5,002 creates): first state gone, later state still consumable
normalizeRankedBest({ statistics: { perfect: 800, great: 20, miss: 0, ok: 3 } })
  → statistics { perfect, great, ok }   // miss dropped
normalizeRankedBest without accuracy → accuracy 0
aggregateCollectionStats([mania 5★ 7K, osu 6★]) → dominantMode "mania", starsMax 6
SHA-256 challenge length is 43 (base64url)
```

These ran in Bun 1.4.4 / Node on the review machine against the imported modules (or a copy of `statsObject` logic). They did not start the Hub HTTP server or open a SQLite file in the repo.
