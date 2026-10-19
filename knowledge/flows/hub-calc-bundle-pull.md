---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/map-analysis/calcBundle.ts
  - apps/desktop/main.js
  - apps/server/src/index.ts
  - apps/server/src/index.node.ts
  - apps/server/src/routes/settings.ts
  - apps/hub/src/routes/calcBundles.ts
  - apps/server/public/features/settings/JobsOnboardingModal.tsx
---

# Hub calc bundle pull → local gap-fill

## User intent

On a Roxysu version change (or first boot of that version), reuse admin-published Sunny/Daniel/Rework dan and dominant-skill rows from the Hub so the player does not recompute every map.

## Flow

```
server boot / version bump
  ↓
jobs.calc_bundle_applied_version !== APP_VERSION?
  ↓ yes
GET Hub /calc-bundles/:APP_VERSION
  ├── 404 → mark applied, stop
  ├── 5xx/timeout → leave unapplied (retry next boot)
  └── 200 entries
        ↓
      applyCalcBundle (match beatmaps.hash)
        packaged install → replace mania-difficulty + mania-skill-v1 rows the bundle contains
        bun desktop / bun dev → gap-fill only (successful local rows kept)
        ↓
      mark jobs.calc_bundle_applied_version = APP_VERSION
        ↓
      (optional) Jobs onboarding / start-recommended backfills leftovers
```

Admin publish path:

```
Settings/Hub admin → export successful local rows
  ↓
upload target is always resolveHubBaseUrl() (no caller URL)
  ↓
chunked POST /admin/calc-bundles (replace then append)
  ↓
Hub store calc_bundles + calc_bundle_entries
```

## Business guarantee

- Only hash-matched maps receive Hub rows.
- Sunny and Daniel successful local computes are never overwritten.
- Packaged version bumps replace rework dan and dominant-skill rows the bundle contains. `bun desktop` does not.
- A manual Settings pull stays gap-fill.
- Kill switch `HUB_CALC_BUNDLES=0` makes public GET return 503.

## Implementation references

- `apps/server/src/map-analysis/calcBundle.ts:maybePullCalcBundleOnBoot()`
- `apps/server/src/map-analysis/calcBundle.ts:reworkReplaceAlgorithmsForBoot()`
- `apps/desktop/main.js` sets `ROXYSU_PACKAGED=1` only when `paths.isPackaged`
- `apps/server/src/map-analysis/calcBundle.ts:applyCalcBundle()`
- `apps/hub/src/routes/calcBundles.ts`
- `apps/server/src/routes/settings.ts` `POST /settings/calc-bundle/export-upload`
