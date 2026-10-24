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
  - apps/desktop/main.js
  - knowledge/vocabulary.md
---

# Hub calc bundle versioning

## Decision

One **Hub calc bundle** per Roxysu product version (e.g. `0.1.17`). Each bundle may include rows for `mania-difficulty` and `mania-skill-v1` only. Match clients to bundles by product version only — not by separate algorithm pins. Apply Hub rows into the local mirror by beatmap content hash. On a packaged install, a product-version bump **replaces** successful `mania-difficulty` and `mania-skill-v1` rows that the bundle contains; maps absent from the bundle keep their previous rows. `bun desktop` leaves `ROXYSU_PACKAGED` unset, so the dev library is gap-filled only and is not replaced. A manual pull from Settings stays gap-fill on every install. Admin may upload for a future version before release. Public pull is killable via `HUB_CALC_BUNDLES=0`.

## Reason

Difficulty and pattern algorithms ship with Roxysu releases. Sharing precomputes across users avoids repeating expensive backfills after an update, while keeping a single artefact per version that admins can prepare ahead of publishing. Rework stars change when the mania difficulty port pin changes, so packaged clients must take the new bundle's rework rows instead of keeping the previous formula. The machine that produces the bundle runs `bun desktop` and must not have that library replaced on the same version bump.

## Consequences

- Hub key is `roxysu_version` (unique). Chunked admin `POST /admin/calc-bundles` with `replace=true` on the first chunk.
- Clients store `jobs.calc_bundle_applied_version` after a successful pull or Hub 404 so boots do not hammer Hub.
- Transport/5xx failures do not mark applied — retry next boot.
- Packaged boot (`ROXYSU_PACKAGED=1` from `apps/desktop/main.js` when `paths.isPackaged`) passes `replaceAlgorithms` for `mania-difficulty` and `mania-skill-v1` only. Dev desktop and `bun run dev` do not.
- Dan difficulty variants and Mania Rating Lab are not part of Hub calc bundles.
- Manual `DELETE /admin/calc-bundles/:version` clears old versions; there is no automatic cleanup.

## Relevant implementation

- `apps/hub/src/services/calcBundles.ts`
- `apps/server/src/map-analysis/calcBundle.ts`
- `apps/server/public/features/hub/HubAdminCalcBundlesPage.tsx`
