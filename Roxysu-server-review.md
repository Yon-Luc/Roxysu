# Roxysu local server (`apps/server`) — in-depth issue analysis

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Default branch reviewed:** `master`  
**Commit:** `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`  
(“Update the docs site download links to v0.1.23.”, 2026-11-03 16:34 Europe/Lisbon)  
**App version:** `0.1.23` (`apps/server/package.json`)  
**Review date:** 2026-11-17 (Europe/Lisbon)  
**Clone used:** `/workspace/Roxysu` (read-only; this document lives outside the repo)

Companion reviews (do not re-fix their items; this document references them by ID):

- `/workspace/Roxysu-desktop-review.md` — Electron shell (`apps/desktop`)
- `/workspace/Roxysu-ui-review.md` — React UI / charts / UX (`apps/server/public`)
- `/workspace/Roxysu-logic-review.md` — mania formulas, stats, sessions, judgments

This is a review of the **local HTTP server** in `apps/server/src`: architecture, request-path performance, reliability, localhost security, and API contracts with the UI and `apps/hub`. Suggested patches match the existing TypeScript style. They are proposals only — nothing in the repo was modified or pushed.

Issue IDs are unique to this document (H1–H2, M1–M10, L1–L5). They are not the desktop, UI, or logic IDs.

---

## What was and was not verified

**Verified in source (this commit):** every issue below was re-read in the files cited. Two small probes were also run on the review machine (Bun 1.4.4, not inside Electron, no packaged app):

1. `Bun.serve({ port })` with no `hostname` reports `hostname: "localhost"` but `ss` shows `*:port`, and `curl http://172.30.0.2:<port>/` (the machine’s LAN address) returned HTTP 200. The same listen with `hostname: "127.0.0.1"` bound only `127.0.0.1:port` and the LAN curl failed with connection refused.
2. Elysia’s documented default for `app.listen(port)` is hostname `0.0.0.0` ([Elysia serve.hostname](https://next.elysiajs.com/patterns/configuration/), also stated in `elysia/src/universal/server.ts`). This tree had no `node_modules`, so Elysia itself was not executed; the Bun default-bind probe plus Elysia’s documented default are the evidence for H1. Marked as such in that section.

**Not verified (do not treat these as runtime measurements):**

- The packaged Electron app, a live lazer `client.realm`, and a large player library were not opened. Payload sizes (preview JSON, skin zips, stats cache misses, score-transfer indexes) are inferred from the code and from existing in-tree measurements (F-021), not from a production database.
- `@elysiajs/node` behaviour on `EADDRINUSE` was not executed. L4 is a missing-handler finding.
- Chrome Private Network Access, Firefox, and Safari were not click-tested against `127.0.0.1:4321`. M1’s browser CSRF discussion is based on current browser rules plus the absence of an Origin check in this tree, not a live exploit.
- `apps/hub` was read only to compare paths and payloads the local server calls. This is not a Hub security review.
- React re-renders, chart math, and hit-window formulas are out of scope here (see the UI and logic reviews).

**Already addressed in this commit, or intentionally out of scope (do not re-open as new bugs):**

- In-tree findings F-001–F-070 are marked `status: fixed` except **F-021** (`status: partial`: Stats still scans every scoped play on a cache miss and holds one compact record per non-hidden play). See that note; this review does not re-file it.
- **F-028** (replay route blocked the request thread) is fixed in part: decode/judge are async, cached, and concurrency-limited. The finding itself still records that the full `stdFrames` / chart payload is returned. Not re-filed; the **preview** endpoint (M2) is a separate, still-synchronous path.
- `knowledge/business/local-no-auth.md` is a product rule: the client API has no user auth, and assumes a **single trusted operator on the client machine**. This review does **not** file “no auth” as a bug. It **does** file cases that break the assumption: binding off loopback (H1), and unauthenticated mutation / `spawn` without an Origin check or path allowlist (H2, M1).
- The same findings README says a tosu host that is not loopback is a **setting**, not an SSRF bug. M5 therefore does not argue “non-loopback is forbidden”; it argues the setting is not *syntactically* validated and the response body is not size-capped.
- Logic-review H1–H3 / M1–M12 / L1–L7 (hit windows, weekly accuracy, judgment key casing, session list cap of 100, skill charts, etc.) and UI-review H1–H2 / M3–M9 / L1–L7 are not repeated. Where a server issue sits next to one of those, the other ID is cited.

---

## Summary table

| ID | Severity | Title | Primary file | Effort |
|----|----------|-------|--------------|--------|
| H1 | High | Bun entry binds all interfaces and ignores `ROXYSU_HOST` / `ROXYSU_PORT` | `apps/server/src/index.ts` | Small (1–2 h) |
| H2 | High | Settings PATCH accepts any `tosuExecutablePath` / mania-rating binary and the server will `spawn()` it | `routes/settings.ts`, `tosu/spawn.ts`, `mania-rating/settings.ts` | Small–medium (path allowlist + tests) |
| M1 | Medium | No Origin / CSRF allowlist on an unauthenticated mutating API | `createApp.ts`, `index.ts`, `routes/settings.ts` | Small (Origin check + tests); land with H1/H2 |
| M2 | Medium | Beatmap preview and detail parse `.osu` files on the request thread and return every note | `routes/beatmaps.ts`, `map-analysis/computeTimingAnalysis.ts` | Medium (async read, cache, slimmer preview) |
| M3 | Medium | Skin list/archive `readFileSync`s every asset into memory and `zipSync`s the lot | `routes/skins.ts` | Medium (streamed zip, cap, don’t preload every file row for the list) |
| M4 | Medium | Score-transfer preview uses a shared `upload.json`, loads the whole library, and checks size too late | `score-transfer/transfer.ts`, `routes/scoreTransfer.ts` | Medium (unique upload dir, early size cap, timeout) |
| M5 | Medium | `tosuHost` / `overlayHostUrl` / `HUB_URL` are under-validated; tosu `.osu` fetch has no size cap | `tosu/settings.ts`, `tosu/analyze.ts`, `hubUrl.ts`, `routes/settings.ts` | Small–medium |
| M6 | Medium | Collection match-cache is not drained on shutdown; no `unhandledRejection` handler | `shared/collectionMatchCache.ts`, `shutdownJobs.ts`, `index.node.ts` | Small |
| M7 | Medium | `GET /settings/calc-bundle/status` materialises every export row just to count them | `routes/settings.ts`, `map-analysis/calcBundle.ts` | Small (SQL count or a running counter) |
| M8 | Medium | Overlay skins PUT and some collection writes accept unbounded bodies | `routes/overlay.ts`, `routes/collections.ts` | Small |
| M9 | Medium | Several Hub calls have no timeout (`BMS` batch, ranked-best pull, OAuth redeem) | `bms/sync.ts`, `online-scores/pull.ts`, `routes/system.ts` | Small |
| M10 | Medium | `POST /marathon/sources` ships the full `.osu` text of every map in the JSON body | `routes/marathon.ts` | Small–medium (hashes / parsed charts only) |
| L1 | Low | Malformed `%` in a static path can throw `URIError` | `createApp.ts` | Trivial |
| L2 | Low | Every static request uses `existsSync` + `statSync` | `createApp.ts` | Small |
| L3 | Low | Many settings / practice query strings have no `maxLength` | `routes/settings.ts`, `routes/practice.ts` | Small; land with M5/M8 |
| L4 | Low | Neither entry point handles `EADDRINUSE` with a clear message | `index.ts`, `index.node.ts` | Small; unverified at runtime |
| L5 | Low | SSE has no cap on concurrent clients | `sse.ts` | Small |

---

## App structure

Roxysu’s local server is the product API **and** the host for the React UI. The Electron shell (desktop review) and the browser both talk to it on port 4321. A separate process, `apps/realm-reader`, is the only writer of `client.realm`; it upserts into the same SQLite mirror the server reads.

```
osu!lazer (client.realm, read-only to Roxysu)
        |
apps/realm-reader  -->  SQLite (ensureDb + Drizzle)
        |
apps/server  --HTTP+SSE-->  Electron window / browser  (UI from public/ or dist/public)
        |
        +-- optional tosu (WS + HTTP) for Now Selected
        +-- optional apps/hub (calc bundles, OAuth, BMS, online scores, search)
```

There are **two entry points**:

| Entry | Runtime | How it is started | Listen | API surface |
|-------|---------|-------------------|--------|-------------|
| `src/index.ts` + `src/app.ts` | Bun | `package.json` `"dev": "bun run --watch src/index.ts"` | `app.listen(4321)` — no hostname, no env | Full API, including Rating Lab |
| `src/index.node.ts` + `src/createApp.ts` | Node (`tsx` / packaged `index.node.js`) | Desktop (`ROXYSU_DESKTOP=1`), `dev:node`, Nix packaged resources | `app.listen({ port, hostname })` with `ROXYSU_PORT` / `ROXYSU_HOST` (default `127.0.0.1:4321`) | Product API only (no Rating Lab) |

That split is deliberate: comments in `routes/index.ts` say Rating Lab must not be pulled into the desktop Node cold-eval path. The UI already hides `/rating-lab` when `isDesktopShell()` is true (`router.tsx`, `AppShell.tsx`, `CommandPalette.tsx`). No contract bug there.

| Piece | Role |
|-------|------|
| `createApp.ts` / `app.ts` | Elysia app: `dbPlugin`, `/api/*` routes, SSE, static UI. Node serves `dist/public` itself because `@elysiajs/static` omitted `Content-Type` on Node. |
| `routes/index.ts` | Mounts every product route under `/api`. |
| `db.ts` / `db.node.ts` / `db-runtime.ts` | `ensureDb` singleton, hydrate `osu.data_path` into an in-process cache. |
| `sse.ts` | `GET /api/events`; 1.5 s poll of latest import + `max(played_at)`; stale-import sweep (F-011). |
| `analytics/pipeline.ts` | Debounced rebuild of sessions, mastery, statistics, retries, BMS derive. Shutdown-aware (`shutdownJobs.ts`). |
| `map-analysis/*` | Dan-variant, rework, pattern-analysis backfill jobs; calc-bundle pull/apply on boot. |
| `tosu/*` | Settings, HTTP probe, optional `spawn` of a configured binary, WS live snapshot. |
| `shared/lazer-files.ts` + `serveHashedFile.ts` | SHA-256-only resolution into lazer `files/{h[0]}/{h[0:2]}/{hash}`. Covers and audio cannot path-traverse. |
| `shared/zipEntryPath.ts` | Zip slip sanitiser (F-033 fixed). |
| `hubUrl.ts` | `HUB_URL`, else production Hub when `ROXYSU_DESKTOP=1`, else `http://localhost:4322`. |
| `hubOAuthPending.ts` + `routes/system.ts` | Desktop OAuth handoff (F-057 addressed with a verifier). |

Background work started at boot (both entries): analytics pipeline, BMS sync, dan-variant job, collection match-cache, tosu adapter, optional calc-bundle pull, poll loop. Shutdown (`SIGINT`/`SIGTERM`) stops tosu, pipelines, poll, `app.stop`, then `shutdownBackgroundWork` (3 s budget) before `closeDb`. Collection match-cache is the notable omission (M6).

Security baseline that is already in good shape on the **file** routes: hashed-file allowlist, range parsing, MIME sniffing, zip entry sanitisation, `resolveStaticFile` prefix check, calc-bundle upload always targeting `resolveHubBaseUrl()` (F-056 fixed), OAuth verifier, product default bind of `127.0.0.1` on the Node/desktop path.

---

## Recommended fix order

Land the “API is only for the person at this machine” invariants first. Several share a small loopback / Origin / URL helper.

1. **H1** — Bind the Bun entry to `127.0.0.1` by default, honour `ROXYSU_HOST` / `ROXYSU_PORT`, fail clearly on `EADDRINUSE` (L4). This is the only High that is already live for anyone running `bun run dev` on a LAN.
2. **H2 + M1 + L3** — Allowlist executable paths, require a loopback Origin (or a same-host CSRF token) on mutating routes, cap settings strings. One PR.
3. **M4** — Unique upload directory, size check before `arrayBuffer()`, timeout on the write CLI. Protects the player’s Realm from a torn preview/commit.
4. **M5 + M9** — Validate `tosuHost` / `overlayHostUrl` / `HUB_URL`, cap tosu/Hub response bodies, add missing `AbortSignal.timeout`s.
5. **M2 + M10** — Async `.osu` reads, cache parsed charts, stop shipping every note / full `osuText` by default.
6. **M3** — Stream skin archives; don’t load every `realm_skin_files` row to summarise the list.
7. **M6** — Stop the collection match-cache on shutdown; add `unhandledRejection` logging (don’t exit 0 over a background throw).
8. **M7, M8, L1, L2, L5** — Cheap hardening and request-path cleanup.

Suggested grouping if you want fewer PRs: (H1+L4), (H2+M1+M5+M8+L3), (M4), (M2+M10+M3), (M9), (M6), (M7+L1+L2+L5).

---

## H1 — Bun entry binds all interfaces and ignores `ROXYSU_HOST` / `ROXYSU_PORT`

**Severity:** High (breaks the documented “localhost only, no auth” rule)

### Where

The Node / Electron entry is careful:

```31:56:apps/server/src/index.node.ts
  const port = Number(process.env.ROXYSU_PORT ?? process.env.PORT ?? 4321);
  const hostname = process.env.ROXYSU_HOST ?? "127.0.0.1";
  // ...
  app.listen({ port, hostname }, (info) => {
    // A client that hangs up mid-upgrade must not take the server with it.
    guardUpgradeSocketErrors(info);
  });
```

The Bun entry used by `apps/server` `"dev"` is not:

```34:34:apps/server/src/index.ts
app.listen(4321);
```

No `hostname`, no `ROXYSU_HOST`, no `ROXYSU_PORT` / `PORT`. Elysia’s documented default hostname for `listen(port)` is `0.0.0.0`. Independently, a probe of Bun 1.4.4’s own `Bun.serve({ port })` (the runtime under that entry) bound `*:port` and answered on the review machine’s LAN address.

The product rule this violates:

```17:20:knowledge/business/local-no-auth.md
## Security rules

1. Do not expose the client app API on a network without introducing explicit auth.
   **Enforced by:** product design / deployment assumption — status: verified
```

The packaged desktop path is **not** this bug: `apps/desktop/main.js` sets `ROXYSU_HOST` / `ROXYSU_PORT` and starts `index.node.js`, which defaults to `127.0.0.1`.

### What happens and why

`dev` (`bun run --watch src/index.ts`) starts an unauthenticated API that can serve:

- every settings value, including osu data paths and tosu executable paths
- hashed lazer audio / backgrounds / `.osu` exports
- mutating routes (settings PATCH, job start, collection write-back, score-transfer commit, `open-in-osu`)

Anyone who can reach TCP 4321 on that machine — another user on the same Wi-Fi, a compromised IoT device, a laptop on the café network the developer joined — can call those routes. Combined with H2, that includes `spawn()` of a caller-chosen path.

### Impact

Developers and anyone else who uses the Bun entry (not the packaged app) silently share the player’s library and settings with the local network. The log line (`Roxysu running at http://${app.server?.hostname}:${app.server?.port}`) can even print `0.0.0.0` or `localhost` while the socket is still `*:4321`, which is exactly what the Bun probe did.

### Repro

1. On a machine with a LAN address, from the repo: `bun run --watch src/index.ts` inside `apps/server` (or the workspace dev script that starts that entry).
2. From another host on the same network, or from the same host using the LAN IP rather than `127.0.0.1`: `curl http://<lan-ip>:4321/api/system/healthz` and `curl http://<lan-ip>:4321/api/settings`.
3. Expected under `local-no-auth.md`: connection refused. Actual on a default Bun listen: 200 and the settings JSON.
4. Confirm with `ss -ltn | grep 4321` — look for `*:4321` vs `127.0.0.1:4321`.

(The packaged desktop app should still show `127.0.0.1:4321`. Do not treat a passing desktop check as a fix for this entry.)

### Proposed patch

Mirror the Node entry in `index.ts`:

```ts
const port = Number(process.env.ROXYSU_PORT ?? process.env.PORT ?? 4321);
const hostname = process.env.ROXYSU_HOST ?? "127.0.0.1";
app.listen({ port, hostname });
```

If `ROXYSU_HOST` is ever set to `0.0.0.0` / `::`, log a prominent warning that the unauthenticated API is now on the network (the rule already forbids this without adding auth). Honouring the env vars also makes desktop-style `ROXYSU_PORT` overrides work in Bun dev, which they currently do not.

### Trade-offs

Binding `127.0.0.1` is IPv4-only. If someone needs IPv6 loopback, bind `127.0.0.1` and `::1`, or document `ROXYSU_HOST=::1`. Do not “fix” this by binding `localhost` and assuming it is loopback-only — the Bun 1.4.4 probe of a default `localhost` hostname still opened `*:port`.

### How to test

- Unit-level: a small helper `resolveListen({ ROXYSU_HOST, ROXYSU_PORT, PORT })` with tests for defaults and overrides.
- Manual: `ss` + a LAN `curl` as in the repro, for both the Bun entry and `tsx src/index.node.ts`.
- Regression: desktop still reaches `http://127.0.0.1:4321/` with `ROXYSU_DESKTOP=1`.

---

## H2 — Settings PATCH accepts any executable path and the server will `spawn()` it

**Severity:** High (unauthenticated process spawn; severity depends on reachability — see H1)

### Where

`PATCH /api/settings` writes a trimmed string with no further checks:

```452:466:apps/server/src/routes/settings.ts
      if (body.tosuExecutablePath !== undefined) {
        if (
          body.tosuExecutablePath === null ||
          body.tosuExecutablePath.trim() === ""
        ) {
          await deleteSetting(db, TOSU_EXECUTABLE_PATH_KEY);
        } else {
          await upsertSetting(
            db,
            TOSU_EXECUTABLE_PATH_KEY,
            body.tosuExecutablePath.trim(),
          );
        }
        tosuChanged = true;
      }
```

`maniaRatingExecutables` is the same shape: a known version id plus any string, stored by `setExecutablePath` (`mania-rating/settings.ts` lines 21–38) with only a trim.

When `tosuChanged` is true, the handler calls `restartTosuAdapter`, which probes and may spawn:

```13:36:apps/server/src/tosu/spawn.ts
export function spawnTosu(executablePath: string): SpawnTosuResult {
  const trimmed = executablePath.trim();
  // ...
  if (!existsSync(trimmed)) { /* warning */ }
  try {
    const cwd = path.dirname(trimmed);
    const child = spawn(trimmed, [], {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
```

There is no `fs.stat` “is a regular file” check, no allowlist directory, no argument sanitising (the path *is* the argv0), and the child is detached so Roxysu will not reap it. The mania-rating job later `spawn`s the configured calculator the same way (`mania-rating/compute.ts`).

The body schema is `t.Optional(t.String())` with no `maxLength` (L3).

### What happens and why

The API is unauthenticated by design. On a loopback-only Node process, only local callers can hit it. On the Bun entry (H1), any LAN client can `PATCH` a path and the next probe will start that binary as the Roxysu user. Even on loopback, another local process, or a browser page that can issue the request (M1), gets the same lever.

`existsSync` is not a safety check: a caller who can write to a world-writable location (or who points at an existing trusted-looking path they control) still wins. `spawn(trimmed, [])` will also execute whatever the OS considers executable at that path, including scripts whose shebang runs a shell.

### Impact

This is the one settings field that turns “change a preference” into “run a process”. The rest of the PATCH surface (filters, thresholds, overlay URL) is annoying or an SSRF-shaped fetch (M5); this one is code execution in the operator’s account.

F-006 (tosu spawn stacking) is fixed and is a different bug. This is input validation, not the spawn-gate.

### Repro

1. With the server running, `curl -X PATCH http://127.0.0.1:4321/api/settings -H 'content-type: application/json' -d '{"tosuEnabled":true,"tosuExecutablePath":"/bin/sleep"}'` (use a benign binary you can identify, not a destructive one).
2. If tosu HTTP is down, the probe path in `refreshProbeAndMaybeSpawn` will call `spawnTosu`. Check `ps` for a detached child whose argv0 is the path you sent.
3. Repeat against the LAN address if you are on the Bun entry (H1).

### Proposed patch

- Require an **absolute** path, `lstat` it, accept only a regular file (reject directories, dangling symlinks if you want to be strict, and device nodes).
- Optionally restrict to an allowlist root (for example the user’s home, a `ROXYSU_TOSU_DIR`, or the directory chosen via a native file picker in the desktop shell). Do not accept relative paths, `PATH` lookups, or paths containing NUL / newlines.
- Cap the string (`maxLength` ~ 512–1024) in the Elysia schema (L3).
- Apply the same helper to `maniaRatingExecutables` and to any future “path to a binary” setting.
- Do not spawn as part of the PATCH if validation fails; return 400 with a stable error string.

A native file-picker in Electron (desktop already has IPC — see desktop M2) is the right UX so the UI never types arbitrary paths; the server must still validate, because the API is reachable without the UI.

### Trade-offs

A strict allowlist will annoy operators who keep `tosu` in an unusual place; a “must be an absolute regular file” rule is the minimum. Detached spawn is probably still wanted so quitting Roxysu does not kill tosu — leave that, but do not skip validation because of it.

### How to test

- Unit tests for the new `assertSafeExecutablePath`: relative path, missing file, directory, NUL, very long string, happy path.
- A settings-route test that a rejected path is not written and `restartTosuAdapter` is not called.
- Confirm a legitimate absolute tosu path still starts (manual).

---

## M1 — No Origin / CSRF allowlist on an unauthenticated mutating API

**Severity:** Medium (cross-site or cross-network callers can mutate; High if H1 is unfixed)

### Where

`createApp.ts` and `app.ts` mount routes with no CORS plugin and no `Origin` / `Referer` / CSRF-token check. A repo-wide search of `apps/server/src` finds no such guard. Mutating routes include:

- `PATCH /api/settings` (H2, path overrides, filters, jobs)
- `POST /api/settings/jobs/*`, rework / pattern start-stop, calc-bundle pull
- `POST /api/tosu/start`
- collection create / patch / delete / `sync-lazer`
- score-transfer preview & commit
- marathon `open-in-osu`
- overlay profile / skins PUT
- `POST /api/system/sync-focus` (can pause Realm sync)

JSON bodies with `Content-Type: application/json` are not “simple” requests, so a public website’s `fetch` should fail the CORS preflight today (the server sends no `Access-Control-Allow-Origin`). That is accidental protection, not a policy.

### What happens and why

Threats that still matter under `local-no-auth.md`:

- **LAN / H1.** No browser is involved. `curl` and other local-network clients do not care about CORS.
- **DNS rebinding** to port 4321. The browser treats the request as same-origin with the attacker’s host; CORS never runs; the server never looks at `Origin`.
- **Simple requests** (`application/x-www-form-urlencoded` form POSTs, some GETs). Most mutating routes use `t.Object({...})` JSON schemas and would 400 a form body — but multipart routes (`/score-transfer/preview`, `/marathon/open-in-osu`) and any future typeless handler are exceptions. GET handlers that *write* (for example `getOrComputePatternAnalysis` on `GET /api/beatmaps/:id`, M2) run for any cross-origin navigation.
- **Chrome Private Network Access** helps for `https://evil.com` → `http://127.0.0.1` in current Chrome, and was **not click-tested** here. It is not a substitute for an Origin allowlist, and it does not apply to LAN clients.

### Impact

Without H1, this is a defence-in-depth gap: a malicious page plus a rebinding trick, or a local HTML file, can change settings or start jobs. With H1 unfixed, it is how a LAN client is “supposed” to be blocked and is not. Either way the fix is the same small middleware.

### Repro

1. From a different origin (or the LAN IP), `OPTIONS` / `POST` a JSON body to `/api/settings` and observe that no `Access-Control-Allow-Origin` is sent (good) and that the server still accepts the request when the caller is not a browser (bad).
2. `GET http://127.0.0.1:4321/api/beatmaps/<id>` from any client and confirm a cache miss can write pattern-analysis rows (M2).

### Proposed patch

For every mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) and, optionally, for sensitive GETs:

- Allow `Origin` that is `http://127.0.0.1:<port>`, `http://localhost:<port>`, or the configured listen origin. Reject anything else with 403.
- Allow non-browser clients that send **no** `Origin` only if the peer address is loopback (or require a static local token in a header for those).
- Do **not** add `Access-Control-Allow-Origin: *`. The UI is same-origin with the API; it does not need CORS.
- Land with H1 so the peer-address check means something.

### Trade-offs

A file opened as `file://` that talks to the API would break if you require Origin; the product UI is not served that way. Dev setups that open the UI from a Vite port on a different port will need that origin listed, or should keep using the server-served UI.

### How to test

- Table-driven tests: allowed origins, `https://example.com`, missing Origin from 127.0.0.1, missing Origin from a non-loopback address (the last one needs a listen on 0.0.0.0 in a test harness, or a mocked peer).
- Manual: the real UI’s settings PATCH and Hub login still work.

---

## M2 — Beatmap preview and detail parse `.osu` files on the request thread and return every note

**Severity:** Medium (UI hitch + multi-megabyte JSON; mania maps make this worse)

### Where

`GET /api/beatmaps/:id/preview` still does a synchronous read and a full parse, then returns **every** mania note (or every osu/taiko/catch hit object) in one body:

```407:512:apps/server/src/routes/beatmaps.ts
      let osuText: string;
      try {
        osuText = readFileSync(filePath, "utf8");
      } catch {
        set.status = 404;
        return { error: "Beatmap file not found in lazer files store" };
      }
      // ... parseStdChart / parseTaikoChart / parseCatchChart / OsuFileParser ...
      const notes: Array<{ column: number; startMs: number; endMs: number }> = [];
      for (let i = 0; i < parser.noteStarts.length; i += 1) {
        // ...
        notes.push({ column, startMs, endMs });
      }
      return { ...base, supported: true, columnCount, appliedMods, notes };
```

`GET /api/beatmaps/:id` also, on the same request, `loadBeatmapOsu` (which itself `readFileSync`s), `analyzeManiaPatternDetail(osuText)`, and `getOrComputePatternAnalysis` (which will **compute and write** a row on a cache miss):

```218:247:apps/server/src/routes/beatmaps.ts
        isMania ? Promise.resolve(getReworkDan(db, params.id)) : Promise.resolve(null),
        isMania
          ? getOrComputePatternAnalysis(db, params.id)
          : Promise.resolve(null),
        isMania ? loadBeatmapOsu(db, params.id) : Promise.resolve(null),
      ]);
      // ...
      if (osuLoaded?.ok) {
        try {
          sevenKAnalysis = analyzeManiaPatternDetail(osuLoaded.osuText);
```

```71:73:apps/server/src/map-analysis/computeTimingAnalysis.ts
    const osuText = readFileSync(filePath, "utf8");
    return { ok: true, osuText, beatmap };
```

This is the preview analogue of F-028 (the replay route). F-028’s fix does not cover these handlers.

Related, but different issues: logic L3 / UI M3 (how the density chart *displays* this data) are not repeated here.

### What happens and why

A long 7K or 10K chart can be tens of thousands of notes. The handler:

1. Blocks the event loop on `readFileSync` and the parser / pattern analyser (the same process also serves `/api/events`, covers, and the rest of the UI).
2. Allocates a notes array and serialises it as JSON. There is no pagination, downsample, or `Accept` switch for a “summary only” payload.
3. On detail, a first-time visitor pays for `getOrComputePatternAnalysis` as a side effect of a GET, including a DB write, with no timeout and no worker.

The live tosu path (`tosu/analyze.ts`) has the same `analyzeManiaPatternDetail` cost, but it is debounced and not on an HTTP request. Opening Practice profile / Now Selected preview is the user-visible hitch.

### Impact

Opening a dense mania map can stall SSE and other API calls for the length of the parse, and can push a several-megabyte JSON body to the tab. Players with long dumps or songs are the ones who hit this most.

### Repro

1. Pick a long, high-NPS mania map in the local library.
2. `GET /api/beatmaps/<id>/preview` and note `Content-Length`, wall time, and that `notes.length` equals the object count.
3. Delete (or never compute) the pattern-analysis row and `GET /api/beatmaps/<id>`; the request should both return `sevenKAnalysis` and insert a `beatmap_pattern_analysis` row.
4. While that request is in flight, time a cheap endpoint such as `/api/system/healthz`.

### Proposed patch

- Replace `readFileSync` with `fs.promises.readFile`, and cap the file size (a 10–20 MiB `.osu` is already pathological).
- Cache parsed charts by `hash` + mtime/size, similar to `replay/replayRuntime.ts`.
- Default preview to a compact payload (column count, length, a downsampled density series, applied mods). Give the playfield a second endpoint or a `?full=1` that can stream or paginate notes.
- Do not compute pattern analysis inside `GET /:id`. Return the cached row, or 202 + `jobs.updated` and let the existing backfill job fill it (the UI already knows how to wait on jobs). If you must compute on demand, do it under the same concurrency limiter as replay judging, and never on the raw request continuation without a yield.
- Reuse that cache from the tosu analyser.

### Trade-offs

A slimmer default preview needs a small UI change in `BeatmapPreviewModal` (UI review). Keep `?full=1` until that lands so behaviour is opt-in rather than a break. Computing analysis only in the background means the first open of an uncached map shows a placeholder — that is better than blocking the whole app.

### How to test

- Fixture a large synthetic `.osu` (e.g. 50k notes) and assert the default preview is bounded, `full=1` still returns all notes, and a concurrent `healthz` is not delayed by a sync read (heuristic: the handler’s first await happens before the parse, parse runs under the limiter).
- Cache-hit test: second preview of the same hash does not re-read the file.

---

## M3 — Skin list/archive `readFileSync`s every asset into memory and `zipSync`s the lot

**Severity:** Medium (memory spikes, blocked event loop)

### Where

`GET /api/skins/` loads **all** `realm_skin_files` rows for every skin (in chunks of 200, but still the full set), then may `readFileSync` each skin’s `skin.ini` on a cache miss:

```70:91:apps/server/src/routes/skins.ts
    const filesBySkin = new Map<...>();
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const fileRows = await db.select(...).from(realmSkinFiles).where(inArray(..., chunk));
      // push every filename+hash
    }
    return { items: rows.map((row) => {
      const summary = summaryFor(row.id, row.hash, filesBySkin.get(row.id) ?? []);
```

`GET /api/skins/:id/archive` reads **every** file into a `Record<string, Uint8Array>` and compresses it with `zipSync`:

```137:176:apps/server/src/routes/skins.ts
      const zipEntries: Record<string, Uint8Array> = {};
      for (const file of files) {
        const entryName = sanitizeZipEntryPath(file.filename);
        if (!entryName) continue;
        const path = resolveLazerFilePath(file.fileHash);
        // ...
        zipEntries[entryName] = new Uint8Array(readFileSync(path));
      }
      const zipped = zipSync(zipEntries);
      return new Response(Buffer.from(zipped), { ... });
```

Path traversal of entry names is already fixed (F-033 / `sanitizeZipEntryPath`). This is the memory and request-thread leftover.

### What happens and why

A lazer skin can be hundreds of megabytes (HD elements, many keymodes). The archive handler holds decompressed copies of every file **plus** the finished zip in memory, and it does so with synchronous reads on the process that serves the UI. The list handler does not need file *bytes* at all for the card view — only filenames (and one `skin.ini` for key counts, which is already memoised).

### Impact

Exporting or even listing a large skin library can hitch the app or OOM the Node/Bun process. This is the skin analogue of the pre-fix F-034 / F-058 “whole artefact in memory” class.

### Repro

1. `GET /api/skins/` on a library with many skins; observe that the query volume is “all file rows”, not “one row per skin”.
2. `GET /api/skins/<id>/archive` on a large skin and watch RSS during the request. (Not measured on this pass; the allocation pattern is visible in the code.)

### Proposed patch

- List: select filenames (and the `skin.ini` hash) only; do not keep every file hash in memory just to summarise.
- Archive: stream a zip (`fflate` unzip/zip streaming, or `archiver`) with a total-byte cap and `createReadStream`, and use async reads. Do not build `Buffer.from(zipped)` of the entire archive.
- Consider `Content-Length` only when cheap; a streamed zip is allowed to be chunked.

### Trade-offs

Streaming zips are slightly more code than `zipSync`. A cap may refuse a huge legitimate skin; surface a clear 413 and let the user export from lazer instead.

### How to test

- List endpoint does not regress key-count detection (memo still fills from `skin.ini` only).
- Archive of a fixture skin with a `..` filename still drops that entry (F-033) and streams a valid `.osk`.
- A cap test with a fake huge file returns 413.

---

## M4 — Score-transfer preview uses a shared `upload.json`, loads the whole library, and checks size too late

**Severity:** Medium (wrong scores can be written to Realm; memory)

### Where

The route always slurps the whole upload first:

```21:34:apps/server/src/routes/scoreTransfer.ts
  .post("/preview", async ({ db, request, set }) => {
    // ...
    const uploaded = form.get("file");
    // ...
    const result = await previewScoreTransfer(db, new Uint8Array(await uploaded.arrayBuffer()));
```

The 256 MiB cap lives **inside** `previewScoreTransfer`, after the allocation:

```33:33:apps/server/src/score-transfer/transfer.ts
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
```

```289:300:apps/server/src/score-transfer/transfer.ts
  if (bytes.byteLength === 0) return { error: "Missing score file" };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: "Score file is too large" };
  // ...
  writeFileSync(uploadPath(), bytes);
  const index = await loadIndex(db);
```

`uploadPath()` is a **single shared file**:

```59:63:apps/server/src/score-transfer/transfer.ts
function uploadPath(): string {
  const dir = path.join(tmpdir(), "roxysu-score-transfer");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "upload.json");
}
```

`commitScoreTransfer` reads that same path (lines 399–413). `loadIndex` selects **every score joined to beatmaps** and **every beatmap** (lines 71–107) on both preview and commit. The Bun write path `runWriteCli` (`npx tsx ... write-score-transfer-once.ts`) has no timeout (lines 361–386). `lease.release()` is idempotent (`realmWriteLock.ts`); the double `release` in `runCommit` + `commitScoreTransfer` is not itself a bug.

F-058 fixed *export* to a streamed JSON body. Preview/commit still materialise the library in memory.

### What happens and why

- Two preview tabs, or a preview in one window and a commit in another, share one `upload.json`. The later preview overwrites the file; the earlier “Commit” writes the *other* player’s (or the other file’s) addable rows into `client.realm`.
- A 1 GiB upload is fully buffered before the 256 MiB check can reject it. Marathon `open-in-osu` already checks `uploaded.size` *before* `arrayBuffer()` — this route does not.
- `loadIndex` is O(library). A large mania library pays that on every preview click, twice if they then commit.
- A hung `npx tsx` child holds the exclusive Realm write lock and the extraction pause until the operator kills it.

### Impact

The race is the serious part: score transfer is a Realm write. A torn commit can insert the wrong scores, which then sync into analytics. The size and index issues are “the app hitch / OOM” of the same feature.

### Repro

1. Preview file A, then from a second client preview file B before committing A. Commit. The Realm write follows B, not A. (Two quick `curl`s are enough; no need for a huge library.)
2. Inspect `loadIndex` — no `WHERE` / `LIMIT`.
3. (Optional) POST a body whose `Blob.size` is > 256 MiB and observe the process RSS rise before the 400.

### Proposed patch

- Check `uploaded.size` (and a hard multipart cap) in the route, before `arrayBuffer()`.
- Write each preview to a unique directory (`mkdtempSync`) and return an `uploadId` the commit must send. Delete on success, on a TTL, and on shutdown.
- Stream or page `loadIndex` (or keep a persistent transfer index invalidated by `sync.finished`).
- Give `runWriteCli` an `AbortSignal.timeout` (30–60 s is plenty) and kill the child on expiry so the Realm lock is released.
- Prefer the in-process `runScoreTransferWrite` path (already used on Node) everywhere, so `npx tsx` is not on the commit path in Bun dev either.

### Trade-offs

An `uploadId` is a small UI change (the current UI assumes “preview then commit, implicit file”). A hidden cookie or single-session slot is a weaker alternative if you want zero UI change, but it still must not be a single global file.

### How to test

- Existing transfer tests plus: two overlapping previews cannot commit each other’s rows; oversize `size` is rejected without parsing; a mocked hung CLI times out and releases the lock (`realmWriteLock` test helper already exists).

---

## M5 — `tosuHost` / `overlayHostUrl` / `HUB_URL` are under-validated; tosu `.osu` fetch has no size cap

**Severity:** Medium (unbounded memory, surprising fetches)

### Where

```59:65:apps/server/src/tosu/settings.ts
export function normalizeTosuHost(raw: string): string {
  let host = raw.trim();
  host = host.replace(/^https?:\/\//i, "");
  host = host.replace(/\/+$/, "");
  if (!host) return DEFAULT_TOSU_HOST;
  return host;
}
```

That value is interpolated:

```58:64:apps/server/src/tosu/analyze.ts
    const res = await fetch(`http://${host}/files/beatmap/file`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
```

`probeTosuHttp` does the same with `fetch(\`http://${host}\`)` (`tosu/status.ts`). There is no cap on `text`, no check that `host` is `host[:port]` only (no `/`, `@`, whitespace, credentials, or IPv6-without-brackets), and no scheme restriction beyond “we always prefix `http://`”.

`overlayHostUrl` only checks an `http://` / `https://` prefix (`routes/settings.ts` lines 424–438). The desktop shell is what actually opens it — see **desktop L7**. The server will store `http://evil.example/overlay` without protest.

`resolveHubBaseUrl` returns any trimmed `HUB_URL` with no scheme/host check (`hubUrl.ts`). The server then `fetch`es calc-bundles, OAuth, BMS, and ranked-bests at that base. An env typo (`file:...`, a missing `http://`, a typo’d host) becomes a surprising outbound call. Desktop defaults this correctly when `ROXYSU_DESKTOP=1`.

Per the in-tree findings README, a *deliberate* non-loopback tosu host is a setting, not filed here as SSRF. The gaps are syntax and size.

### What happens and why

- `tosuHost=evil.example/steal?x=` becomes `http://evil.example/steal?x=/files/beatmap/file`.
- `tosuHost=user@127.0.0.1:24050` or a host with spaces/CRLF is also accepted.
- A tosu (or anything sitting at that URL) that returns a huge body is fully buffered by `res.text()` / `res.json()` after the 8 s *connection* timeout has already succeeded. The live analyser then runs `runReworkEstimatorFromText` and `analyzeManiaPatternDetail` on that string (event-loop cost, same family as M2).
- A bad `HUB_URL` is used by several call sites, some of which also lack a timeout (M9).

### Impact

A typo or a hostile tosu dashboard can stall or OOM the server process that is also the UI. Overlay URL confusion is mostly a desktop-host issue (desktop L7) but starts with this missing server-side check.

### Repro

- `normalizeTosuHost("http://example.com/foo/")` should not be considered a valid host — today it returns `example.com/foo`.
- Point `tosuHost` at a local file server that returns a multi-hundred-megabyte body from `/files/beatmap/file` and watch RSS during Now Selected analysis. (Not executed here; the missing cap is in source.)

### Proposed patch

- Parse with `URL` after forcing `http://`, require `pathname === '/'` or empty, reject userinfo, and allow only loopback *or* (if you keep the “custom host is a setting” rule) a well-formed `hostname` + numeric port in a documented range.
- Cap the `.osu` body (e.g. 20 MiB) with a streamed read; abort over the cap.
- Validate `overlayHostUrl` as a real `URL`, http(s) only, and — if the overlay host is only ever local — loopback + an allowlisted path/hash (`#/overlay...`). Share the helper with desktop L7.
- Validate `HUB_URL` as `http:`/`https:` with a hostname, no userinfo, and a trailing-slash strip (already done). Refuse other schemes.

### Trade-offs

Rejecting non-loopback tosu hosts would contradict the documented setting. Syntax + size is the compatible fix. If you later want “loopback only”, make it an explicit settings flag defaulting to on.

### How to test

- Extend `tosu/settings` and `hubUrl.test.ts` with the rejected forms above.
- A fake HTTP server that sends a long body should yield `null` text and no throw.

---

## M6 — Collection match-cache is not drained on shutdown; no `unhandledRejection` handler

**Severity:** Medium (shutdown races, swallowed background failures)

### Where

Both entries start the cache and never keep a stop handle:

```39:39:apps/server/src/index.ts
startCollectionMatchCache(db);
```

```107:121:apps/server/src/shared/collectionMatchCache.ts
export function startCollectionMatchCache(db: Db): void {
  subscribe((event) => {
    if (event.type === "sync.finished") {
      invalidateCollectionMd5Cache();
      scheduleRefreshAllMatchCounts(db);
      return;
    }
    if (event.type === "mastery.updated") {
      scheduleRefreshAllMatchCounts(db);
    }
  });
  if (hasUncachedCollections(db)) {
    scheduleRefreshAllMatchCounts(db);
  }
}
```

`subscribe` returns an unsubscribe function; it is discarded. `scheduleRefreshAllMatchCounts` can still be running `countMatchesPure` + `UPDATE collections` when shutdown reaches `closeDb`. `shutdownBackgroundWork` (`shutdownJobs.ts`) waits for analytics, dan/pattern/rating jobs, and the mirror batch — not this refresh.

Neither `index.ts` nor `index.node.ts` registers `process.on("unhandledRejection")` or `uncaughtException`. The only `.catch` on the Node entry is `main().catch`. Boot’s `maybePullCalcBundleOnBoot` already swallows its own errors (good). SSE, poll, and most jobs log and continue; a thrown promise from a new path still takes the default Node/Bun behaviour (deprecated unhandled-rejection warning, or a hard crash depending on the runtime flags).

### What happens and why

F-059 (shutdown closed the DB under writers) was fixed for the listed jobs. The match-cache was added as a lazy writer and never joined that list. A quit during `sync.finished` can:

- throw inside the refresh after `closeDb`,
- or write to a closing better-sqlite3 handle,
- and if that throw is unhandled, skip the rest of shutdown or confuse the desktop “server exited” path (desktop M8).

### Impact

Intermittent shutdown errors, a stuck “Quit” if the desktop is waiting on a clean exit, and the occasional missed `cached_match_count` update (the next boot will backfill, so this part is mild).

### Repro

Unit-test style: start the cache, publish `sync.finished`, then immediately run `shutdownBackgroundWork` + `closeDb` and assert the refresh has finished or aborted without throwing. A tight loop of “import then Ctrl-C” is the manual form. Unhandled-rejection coverage is a test that a rejected `void foo()` is logged.

### Proposed patch

- `startCollectionMatchCache` should return a `stop()` that unsubscribes, sets a cancelled flag, and awaits the in-flight refresh (with the same 3 s budget as other jobs). Call it from `shutdownBackgroundWork`.
- Add `process.on("unhandledRejection", ...)` and `uncaughtException` loggers in both entries. Log and continue for the former; for the latter, prefer the existing `shutdown()` path over a silent `process.exit(0)`.

### Trade-offs

Waiting for a full `countMatchesPure` over many collections can exceed 3 s. Honour the deadline and leave `cached_match_count` stale — the next boot already backfills nulls.

### How to test

- Extend `shutdownJobs.test.ts` with a fake “refresh still running” status.
- A test that `stop()` unsubscribes (a later `publish` must not start a new run).

---

## M7 — `GET /settings/calc-bundle/status` materialises every export row just to count them

**Severity:** Medium (unnecessary CPU and memory on a settings poll)

### Where

```224:229:apps/server/src/routes/settings.ts
  .get("/calc-bundle/status", async ({ db }) => ({
    appVersion: APP_VERSION,
    appliedVersion: await getCalcBundleAppliedVersion(db),
    pull: getCalcBundlePullState(),
    exportCount: (await exportCalcBundleEntries(db)).length,
  }))
```

```229:237:apps/server/src/map-analysis/calcBundle.ts
export async function exportCalcBundleEntries(
  db: Db,
): Promise<CalcBundleEntry[]> {
  const out: CalcBundleEntry[] = [];
  for await (const entry of iterateCalcBundleEntries(db)) {
    out.push(entry);
  }
  return out;
}
```

The settings page and any poll of this endpoint walk every rework + pattern row, allocate the export DTO, and throw it away after `.length`.

### What happens and why

`iterateCalcBundleEntries` already streams. The status route collects the stream into an array. On a large mania library this is a needless full scan of the same data the backfill jobs write, on a path the UI can hit often.

### Impact

Settings / jobs UI feels slow after the library has grown; the scan also contends with SQLite writers (imports, analytics).

### Repro

`GET /api/settings/calc-bundle/status` on a library with tens of thousands of analysed maps and compare time / allocations to a `SELECT count(*)` of the same rows. (Not benchmarked here; the extra materialisation is in source.)

### Proposed patch

Add `countCalcBundleEntries(db)` that runs the same filters as the iterator in SQL (or keeps a counter when a bundle is applied). Use it in this handler. Keep `exportCalcBundleEntries` for the actual export/upload.

### Trade-offs

The count query must stay in lock-step with the iterator’s filters so the number matches a later export. A test that `count === export.length` on a fixture is enough.

### How to test

That equality test, plus a route test that the handler does not call the materialising export (spy).

---

## M8 — Overlay skins PUT and some collection writes accept unbounded bodies

**Severity:** Medium (SQLite / memory)

### Where

```235:270:apps/server/src/routes/overlay.ts
  .put(
    "/skins",
    async ({ db, body }) => {
      const raw = body as Record<string, unknown>;
      // each sprite: data URL, length <= 8_000_000
      sprites[key.slice(0, 128)] = value;
      // mania/std/taiko/catch copied through
      const value = JSON.stringify(snapshot);
      await db.insert(settings).values({ key: OVERLAY_SKINS_KEY, value })...
    },
    { body: t.Any() },
  )
```

Per-sprite there is an 8 MB cap, but there is **no cap on the number of keys** and no cap on the JSON in `mania` / `std` / `taiko` / `catch`. `t.Any()` also skips schema-level body-size limits. Profiles go through `sanitizeOverlayProfile` (size-clamped layout) — that path is in better shape; `t.Any()` there is only a smell.

Smart-collection create and patch are inconsistent with the batch route:

```431:434:apps/server/src/routes/collections.ts
      body: t.Object({
        name: t.String({ minLength: 1 }),
        query: t.String({ minLength: 1 }),
      }),
```

The batch/import path already uses `maxLength: 200` / `2000`. Patch (`name` / `query` optional, lines 607–608) also has no max. A multi-megabyte `query` is stored and then run by `countMatchesPure` on every `sync.finished` (M6).

Practice / search `q` is also `t.Optional(t.String())` with no max (L3).

### What happens and why

A single skins PUT can concatenate thousands of 8 MB data URLs into one `settings.value` text column. SQLite will take it until the process or the page cache does not. A huge collection query is a cheaper way to stall the match-cache loop.

### Impact

Settings row bloat, long GC pauses, and a stuck collection refresh. Less severe than H2, but it is on an unauthenticated PUT (M1).

### Repro

- PUT `/api/overlay/skins` with many `sprites` keys each just under 8 MB (or a huge `mania` object). Observe the settings row size and RSS.
- POST `/api/collections` with a several-megabyte `query` and then trigger `sync.finished`.

### Proposed patch

- Replace `t.Any()` with a typed body: max number of sprites (e.g. 256), a **total** byte budget (e.g. 16–32 MiB), and a size-limited layout object for `mania`/`std`/….
- Use the same `maxLength` on create/patch as the batch route; reject oversize queries with 400 before they are stored.
- Add a global Elysia / Node body limit for `/api` (a few megabytes, with an explicit higher cap only on the skin and score-transfer routes).

### Trade-offs

Legitimate huge overlay skins (lots of imported `.osk` elements) need a documented cap. 8 MB × a handful of key textures should still fit under a 32 MiB total.

### How to test

- Overlay skins: 2 small sprites OK; 3,000 sprites or an oversized total → 400, nothing written.
- Collections: create/patch over `maxLength` → 400; batch and single-create agree.

---

## M9 — Several Hub calls have no timeout

**Severity:** Medium (a hung Hub freezes a loop that holds state)

### Where

These `fetch`es have no `AbortSignal.timeout` (unlike BMS *table* catalogue fetches in `routes/bms.ts`, which already use 8 s / 20 s, and unlike `fetchHubCalcBundle`, which has `HUB_TIMEOUT_MS`):

```419:427:apps/server/src/bms/sync.ts
  const res = await fetch(`${resolveHubBaseUrl()}/api/bms/scores/batch`, {
    method: "POST",
    headers: { /* Bearer token */ },
    body: JSON.stringify(body),
  });
```

```157:162:apps/server/src/online-scores/pull.ts
  const url = new URL(`${resolveHubBaseUrl()}/osu/scores/best`);
  // ...
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${hubJwt}`, Accept: "application/json" },
  });
```

```149:159:apps/server/src/routes/system.ts
        const res = await fetch(
          `${hubBaseUrl()}/auth/handoff/${encodeURIComponent(hubId)}`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ verifier }),
            cache: "no-store",
          },
        );
```

`tickBmsSync` will not start a second tick while `ticking` is true (`bms/sync.ts`). A hung batch POST therefore stalls the whole BMS upload loop. `hubPull` sits on the online-score preview request path. OAuth redeem sits on `POST /api/system/hub-oauth/pending`.

Path contracts with `apps/hub` itself were checked and **match**: `/calc-bundles/:version`, `/osu/scores/best`, `/api/bms/scores/batch`, `/auth/handoff/:id`, `/auth/me`. No path-level mismatch was found. This is a reliability gap, not a wrong URL.

### What happens and why

A slow or wedged Hub (or a black-hole `HUB_URL`, M5) leaves `fetch` pending until the OS gives up, which can be minutes. During that time BMS scores stay in `uploading`, the online-score modal spins, or the desktop OAuth “pending” poll looks like a failed login.

### Impact

Features that talk to the community Hub appear “dead” with no error until the socket times out at the platform layer. A stuck `uploading` row can also delay later ticks.

### Repro

Point `HUB_URL` at a local port that accepts TCP and never responds. Start BMS sync or an online-score pull. The request does not fail in 8–20 s the way the table catalogue already does.

### Proposed patch

Use one helper, e.g. `hubFetch(path, init, timeoutMs = 15_000)`, for every Hub call, with a timeout and a bounded `res.json()` / `res.text()`. Map abort to a typed `HubTimeoutError` so the UI can say “Hub did not respond”. On BMS batch abort, move rows back to `retry_wait` rather than leaving them `uploading`.

### Trade-offs

A 15 s cap may be tight for a huge ranked-best pull; that endpoint can use a longer timeout (30–60 s) without going unlimited.

### How to test

- A mock server that never writes a response: each of the three call sites rejects within the budget.
- BMS: aborted batch does not leave rows stuck in `uploading` (extend the existing sync tests).

---

## M10 — `POST /marathon/sources` ships the full `.osu` text of every map in the JSON body

**Severity:** Medium (large response, sync parse, work the client may not need)

### Where

```97:129:apps/server/src/routes/marathon.ts
        const osuText = readOsuText(row.hash); // readFileSync
        // ... parseOsuChart(osuText) ...
        sources.push({
          id: row.id,
          // ... metadata ...
          osuText,
          error: null,
        });
```

Up to `MARATHON_MAX_MAPS` (12) full `.osu` files go back to the browser, after a synchronous read+parse per id, on the request thread. Audio hashes are also returned so the client can build the marathon; the raw chart text is the bulky part.

Logic L7 already said marathon had no additional *formula* defects; this is a server payload / request-path issue, not a formula one. F-034 (full PCM in memory during export) is marked fixed and is a different path.

### What happens and why

The UI asked for “sources”. The server also sends the entire chart text so the client can generate the mashup without a second fetch. That is convenient and expensive: 12 long mania charts can be several megabytes of JSON, and the event loop blocks while they are read.

### Impact

Opening Marathon with a handful of dense maps hitchs the tab and the server. Mobile-sized Electron windows with limited memory feel this first.

### Repro

`POST /api/marathon/sources` with 12 long mania ids and inspect the response size / presence of `osuText` for each source.

### Proposed patch

Return metadata, `keyCount`, hashes, and (if the generator stays in the browser) a *parsed* compact note list or a separate `GET /beatmaps/:id/preview?full=1` that the client already has (M2). If generation moves to the server, do not send `osuText` at all. Async reads, same file-size cap as M2.

### Trade-offs

A client that already expects `osuText` needs a coordinated UI change. A short deprecation (`osuText` still present, plus `notes`) lets you flip the client in a second PR.

### How to test

- Contract test: sources for a fixture map include `keyCount` and no longer require a multi-megabyte body.
- Mixed key counts still return `keyCount: null` (logic / F-064 behaviour preserved).

---

## L1 — Malformed `%` in a static path can throw `URIError`

**Severity:** Low

### Where

```39:49:apps/server/src/createApp.ts
function resolveStaticFile(root: string, urlPathname: string): string | null {
  const rootResolved = path.resolve(root);
  const relative = decodeURIComponent(urlPathname).replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  // ... prefix check, existsSync, statSync ...
}
```

`decodeURIComponent("%")` or `"%zz"` throws `URIError`. The `GET /*` handler does not catch it. Elysia may turn that into a 500, or (if an error slips an `unhandledRejection`, M6) worse. The prefix check after a successful decode is otherwise sound and blocks `../` escapes.

### Proposed patch

Wrap `decodeURIComponent` in try/catch and return `null` (404) on failure, the same way NUL is rejected.

### How to test

`GET /%` and `GET /foo%2e%2e%2fbar` — 404, not 500; the second must not escape `staticAssetsDir`.

---

## L2 — Every static request uses `existsSync` + `statSync`

**Severity:** Low

### Where

Same `resolveStaticFile` (lines 48–49). Node’s product entry serves the UI here (`index.html`, hashed JS/CSS). Each request hits the disk twice synchronously before `readFile`. Hashed assets are already marked immutable (`cacheControlFor`).

### Proposed patch

`stat` via `fs.promises.stat` inside `readStaticFile`, treat `ENOENT` as a miss, and skip the extra `existsSync`. Optionally remember hashed filenames (they never change on disk for a given build).

### Trade-offs

Negligible for a local app; worth doing when you touch L1 anyway so the Node request path stays async.

---

## L3 — Many settings / practice query strings have no `maxLength`

**Severity:** Low (bundles with M5 / M8)

`tosuHost`, `tosuExecutablePath`, `overlayHostUrl`, `osuDataPath`, practice `q` / `exclude`, search `q`, overlay `profile` query, and a few collection fields (M8) are plain `t.String()`. A multi-megabyte query string is a cheap way to inflate logs, SQLite settings, and `toStructuredQuery`. Cap them at reasonable values (paths 1–2 KB, queries 2 KB to match the collection batch route, hosts 256 bytes).

---

## L4 — Neither entry point handles `EADDRINUSE` with a clear message

**Severity:** Low (unverified at runtime)

`index.ts` calls `app.listen(4321)` with no error callback. `index.node.ts` passes a listen callback only to install `guardUpgradeSocketErrors`. There is no `server.on("error")` and no dedicated `EADDRINUSE` message.

Desktop M4 already covers the *shell* treating any HTTP status below 500 as “our server”. This item is the server-side counterpart: if 4321 is taken, the process may throw through `main().catch` (Node, exit 1, no friendly reason) or behave in an `@elysiajs/node`-specific way that was **not executed** here.

### Proposed patch

Listen with an error handler; on `EADDRINUSE` print “port N is already in use (ROXYSU_PORT)” and `process.exit(1)` before starting pipelines. Optionally refuse to start pipelines until `listening` fires.

---

## L5 — SSE has no cap on concurrent clients

**Severity:** Low

`GET /api/events` (`sse.ts`) adds a subscriber per connection and a 20 s ping interval, with no maximum. Each tosu `play` tick (throttled to 500 ms) is serialised to every client. The product UI opens one EventSource; a stuck tab, a leaked worker, or a LAN scanner (H1) can open many.

Cap at a small number (e.g. 16), close the oldest or return 503, and make sure `cancel` / `abort` always `unsubscribe` (the current `cleanup` already does this for a single stream).

---

## API contracts with the UI and `apps/hub`

Checked, and **not** filed as defects:

- Desktop vs Bun API surface: Rating Lab is omitted from `createProductApiRoutes()` and hidden in the desktop UI. Intentional.
- Hub paths the server calls all exist in this commit’s `apps/hub` tree with matching prefixes: `/calc-bundles/:version`, `/osu/scores/best`, `/api/bms/scores/batch`, `/api/bms/tables`, `/auth/handoff/:id`, `/auth/me`.
- F-056 (calc-bundle upload to a caller-supplied Hub URL) is fixed: uploads always use `resolveHubBaseUrl()`.
- `/api/system/status` exposes `hubUrl: resolveHubBaseUrl()` for the UI — consistent with Workshop / OAuth / search.

Remaining contract-adjacent work is M9 (timeouts), M5 (`HUB_URL` scheme), and M10 / M2 (response shape changes that need a coordinated UI PR).

Sessions list capped at 100 with a 371-day activity calendar is **logic M10 / UI M6** — not repeated.

Now Selected stale analysis is **UI H2** (the client ignores the checksum the server already returns from `GET /api/tosu/live/analysis`). The server payload includes `checksum`; no server contract bug.

---

## Already fine (short)

- Hashed-file routes (`/api/covers/:hash`, `/api/audio/:hash`) reject non-SHA-256 input and stay under the lazer files root. Audio range serving is implemented carefully (`parseBytesRange`, 416 + `Content-Range`).
- Static path prefix check in `resolveStaticFile` blocks `..` after `path.resolve`.
- Zip entry names for `.osk` export are sanitised (`sanitizeZipEntryPath`).
- Score-transfer *export* is streamed (F-058). Mirror `owned-set-ids` is paginated (F-054). Batch `setIds` is capped (F-055).
- Shutdown waits for analytics and the listed backfill / mirror jobs (F-059), with a 3 s budget.
- Stale `running` imports are failed from the poll loop (F-011). The analytics pipeline waits for a live import (F-002).
- OAuth redeem requires the verifier (F-057). Upgrade `EPIPE` on `@elysiajs/node` is guarded (`upgradeSocketGuard.ts`).
- Node/desktop listen default of `127.0.0.1` is the right default — only the Bun entry misses it (H1).

---

## Review limits, again

This is a source review of `apps/server/src` at `bc3eb6b`, plus the two listen probes described at the top. It is not a load test, not a packaged-app run, and not a Hub review. Formula and chart issues live in the logic and UI documents; Electron-shell issues live in the desktop document. If you want patches next, H1 + H2 + M1 are the smallest change with the largest payoff.
