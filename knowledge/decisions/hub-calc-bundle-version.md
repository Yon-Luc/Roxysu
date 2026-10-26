---
last_verified: 2026-10
confidence: verified
touches:
  - packages/db/src/hub/schema.ts
  - apps/hub/src/services/calcBundles.ts
  - apps/hub/src/routes/admin.ts
  - apps/hub/src/routes/calcBundles.ts
  - apps/hub/src/services/hubEnv.ts
  - apps/server/src/map-analysis/calcBundle.ts
  - apps/server/src/map-analysis/calcBundleFile.ts
  - apps/server/src/routes/settings.ts
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
  - apps/server/public/lib/sse.ts
  - apps/server/public/features/hub/HubAdminCalcBundlesPage.tsx
  - apps/desktop/main.js
  - apps/desktop/scripts/after-pack.mjs
  - apps/desktop/scripts/build-pack.mjs
  - nix/package.nix
  - knowledge/vocabulary.md
---

# Hub calc bundle versioning

## Decision

One **Hub calc bundle** per Roxysu product version (e.g. `0.1.17`). Each bundle may include rows for `mania-difficulty` and `mania-skill-v1` only. Match clients to bundles by product version only — not by separate algorithm pins. Apply Hub rows into the local mirror by beatmap content hash. On a packaged install, a product-version bump **replaces** successful `mania-difficulty` and `mania-skill-v1` rows that the bundle contains; bundle algorithm rows the file does **not** contain are **dropped** (their content hash is not vouched for by the new formula, so the beatmap page must not keep showing the previous formula's star) and re-enter the missing-only rework backfill, which the server entry points start when the drop actually deleted rows. `bun desktop` leaves `ROXYSU_PACKAGED` unset, so the dev library is gap-filled only and is not replaced. A manual pull from Settings stays gap-fill on every install. Admin may upload for a future version before release. Public pull is killable via `HUB_CALC_BUNDLES=0`.

**Packaged installs ship the bundle as a file and never call the Hub at boot.** Before packing a release, the admin generates the **Calc bundle file** for the upcoming version (`GET /settings/calc-bundle/export-file`), saves it as `apps/desktop/pack/calc-bundle.ndjson.gz`, and the release artifact stages it into `resources/`. At boot a packaged install reads that file (path passed via `ROXYSU_CALC_BUNDLE_FILE` from `apps/desktop/main.js`), validates its header version against `APP_VERSION`, applies it with the replace semantics above, and marks applied. A missing/unreadable/mismatched file still marks applied — the file cannot self-heal between boots — and logs a warning; **there is no Hub fallback on the packaged boot path by design.** Dev boots (`bun desktop`, `bun run dev`) keep the Hub pull as the only gap-fill source. The file cannot be regenerated for other users: only the release that shipped it carries its rows.

## Reason

Difficulty and pattern algorithms ship with Roxysu releases. Sharing precomputes across users avoids repeating expensive backfills after an update, while keeping a single artefact per version that admins can prepare ahead of publishing. Rework stars change when the mania difficulty port pin changes, so packaged clients must take the new bundle's rework rows instead of keeping the previous formula — and rows the new file does not vouch for must not survive the bump either, or the beatmap page keeps disagreeing with the live Now selected estimate until the user runs Recalculate all by hand. Dropping those rows and letting the missing-only backfill recompute them keeps every stored rating on the current formula without re-computing a covered library. The machine that produces the bundle runs `bun desktop` and must not have that library replaced on the same version bump.

Packaged installs read a local file instead of pulling the Hub: the bundle is version-keyed by construction (it ships with the exact release), most of its content is identical for every user, and one released file removes the per-user, per-version boot request load from the Hub. The Hub bundle store stays authoritative for dev-gap-fill, manual pull, and admin upload; the file is the transport for packaged users.

## Consequences

- Hub key is `roxysu_version` (unique). Chunked admin `POST /admin/calc-bundles` with `replace=true` on the first chunk.
- The calc bundle file header carries `format`, `roxysuVersion` (must equal `APP_VERSION` at boot), `algorithms`, `entryCount`. Entries carry no `onlineBeatmapId` and no null columns — the file only contains what the boot apply writes.
- Clients store `jobs.calc_bundle_applied_version` after a successful file apply, Hub pull, or Hub 404 so boots do not repeat work.
- Packaged replace is replace-**then-drop**: after the file's rows are written, `dropCalcBundleLeftovers()` deletes bundle-algorithm rows whose `beatmap_hash` is null or not in the file (temp table of file hashes + one `NOT IN (SELECT …)` delete per table, one transaction). The count travels back as `CalcBundleBootResult.droppedLeftovers`; the server entry points (`src/index.ts`, `src/index.node.ts`) start `startReworkDanBackfill` **only** when rows were dropped. Dan difficulty variants are not part of this — nothing recomputes them here.
- On a successful shipped-file apply the server publishes `calc-bundle.applied` (once per product-version bump). The client invalidates `["beatmap"]` and `["practice"]` on it so an already-open beatmap page refetches after the boot apply finished.
- Transport/5xx Hub failures (dev path) do not mark applied — retry next boot. A failed shipped-file read (packaged path) **does** mark applied, with the reason logged and shown in the pull state.
- Packaged boot (`ROXYSU_PACKAGED=1` from `apps/desktop/main.js` when `paths.isPackaged`, or Nix `ROXYSU_RESOURCES`) applies the shipped file with `replaceAlgorithms` for `mania-difficulty` and `mania-skill-v1` only. Dev desktop and `bun run dev` do not read the file and do not replace.
- Bundle reads/parse are synchronous; apply runs in slices (hash lookups and existing-row reads batched per slice, writes in one transaction per slice) — 130k entries measured at ~23 s with sub-second event-loop blocks.
- A release packed without the file (or with a stale header version — `build:stage` warns on mismatch against `apps/server/package.json`) leaves packaged clients without boot gap-fill; previous-version rows stay. Warn, not fail: shipping without the file must remain possible.
- Dan difficulty variants and Mania Rating Lab are not part of Hub calc bundles or the calc bundle file.
- Manual `DELETE /admin/calc-bundles/:version` clears old versions; there is no automatic cleanup.

## Relevant implementation

- `apps/hub/src/services/calcBundles.ts`
- `apps/server/src/map-analysis/calcBundle.ts` — export/iterate, batched apply, replace-then-drop (`dropCalcBundleLeftovers`, `CalcBundleBootResult`), boot dispatch, file build
- `apps/server/src/index.ts`, `apps/server/src/index.node.ts` — boot calls; auto-start the missing backfill when `droppedLeftovers > 0`
- `apps/server/public/lib/sse.ts` — client invalidation on `calc-bundle.applied`
- `apps/server/src/map-analysis/calcBundleFile.ts` — file format, read/validate
- `apps/server/src/routes/settings.ts` — `GET /settings/calc-bundle/export-file`
- `apps/server/public/features/hub/HubAdminCalcBundlesPage.tsx` — admin export/upload/download
- `apps/desktop/main.js` — `ROXYSU_CALC_BUNDLE_FILE` env passthrough
- `apps/desktop/scripts/after-pack.mjs` — electron-builder staging; `nix/package.nix` — Nix staging
- `apps/desktop/scripts/build-pack.mjs` — presence + header-version warning
