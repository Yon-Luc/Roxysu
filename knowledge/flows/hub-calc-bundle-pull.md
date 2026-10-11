---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/map-analysis/calcBundle.ts
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
      applyCalcBundle (match beatmaps.hash; gap-fill only)
        ↓
      mark jobs.calc_bundle_applied_version = APP_VERSION
        ↓
      (optional) Jobs onboarding / start-recommended backfills leftovers
```

Admin publish path:

```
Settings/Hub admin → export successful local rows
  ↓
chunked POST /admin/calc-bundles (replace then append)
  ↓
Hub store calc_bundles + calc_bundle_entries
```

## Business guarantee

- Only hash-matched maps receive Hub rows.
- Successful local computes are never overwritten.
- Kill switch `HUB_CALC_BUNDLES=0` makes public GET return 503.

## Implementation references

- `apps/server/src/map-analysis/calcBundle.ts:maybePullCalcBundleOnBoot()`
- `apps/server/src/map-analysis/calcBundle.ts:applyCalcBundle()`
- `apps/hub/src/routes/calcBundles.ts`
- `apps/server/src/routes/settings.ts` `POST /settings/calc-bundle/export-upload`
