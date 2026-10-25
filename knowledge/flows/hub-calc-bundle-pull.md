---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/map-analysis/calcBundle.ts
  - apps/server/src/map-analysis/calcBundleFile.ts
  - apps/server/src/routes/settings.ts
  - apps/desktop/main.js
  - apps/desktop/scripts/after-pack.mjs
  - apps/desktop/scripts/build-pack.mjs
  - nix/package.nix
  - apps/server/public/features/hub/HubAdminCalcBundlesPage.tsx
---

# Calc bundle → local mirror (release file / Hub pull)

## User intent

On a Roxysu version change (or first boot of that version), reuse admin-produced Rework dan and dominant-skill rows so the player does not recompute every map. Packaged users get the rows from the file shipped with the release; dev runs pull from the Hub.

## Flow

Admin release prep:

```
bump apps/server/package.json (+ desktop) to the next version
  ↓
run dev client app → Settings/Community → Hub admin → Calc bundles
  ↓
"Download release file (.ndjson.gz)" → GET /api/settings/calc-bundle/export-file?version=<next>
  ↓ (buildCalcBundleFileBytes: header + stripped entries, gzip)
save as apps/desktop/pack/calc-bundle.ndjson.gz   ← gitignored admin artifact
  ↓
pack release (electron-builder afterPack / Nix installPhase) → resources/calc-bundle.ndjson.gz
  (build:stage warns when the file is missing or its header version ≠ package version)
  (optionally "Export & upload" publishes the same rows to the Hub store for dev users)
```

Packaged boot:

```
server boot / version bump
  ↓ (apps/desktop/main.js passes ROXYSU_CALC_BUNDLE_FILE when resources/ has the file)
jobs.calc_bundle_applied_version !== APP_VERSION?
  ↓ yes (ROXYSU_PACKAGED=1 → shipped-file path only, never a Hub call)
readShippedCalcBundleFile(ROXYSU_CALC_BUNDLE_FILE, APP_VERSION, CALC_BUNDLE_ALGORITHMS)
  ├── missing/unreadable/malformed/version-mismatch
  │     → log reason, mark applied, pull state source=file status=skipped (no retry)
  └── ok
        ↓
      applyCalcBundle (batched slices; match beatmaps.hash)
        → replace mania-difficulty + mania-skill-v1 rows the file contains
        ↓
      mark jobs.calc_bundle_applied_version = APP_VERSION
        ↓
      (optional) Jobs onboarding / start-recommended backfills leftovers
```

Dev boot (`bun desktop` / `bun run dev`, no `ROXYSU_PACKAGED`):

```
jobs.calc_bundle_applied_version !== APP_VERSION?
  ↓ yes
GET Hub /calc-bundles/:APP_VERSION
  ├── 404 → mark applied, stop
  ├── 5xx/timeout → leave unapplied (retry next boot)
  └── 200 entries
        ↓
      applyCalcBundle — gap-fill only (successful local rows kept)
        ↓
      mark jobs.calc_bundle_applied_version = APP_VERSION
```

Manual pull from Settings stays a Hub gap-fill on every install type
(`POST /settings/calc-bundle/pull`); it never replaces dev- or user-computed rows.

## Business guarantee

- Only hash-matched maps receive bundle rows.
- Bundles (Hub and file) carry `mania-difficulty` and `mania-skill-v1` only (other algorithm ids are ignored).
- Packaged version bumps replace successful rework dan and dominant-skill rows the bundle contains. `bun desktop` does not replace.
- Packaged boots never call the Hub; dev boots never read the file. A release without the file ships with no boot-time gap-fill (previous-version rows stay).
- A manual Settings pull stays gap-fill.
- Kill switch `HUB_CALC_BUNDLES=0` makes the Hub public GET return 503; the shipped-file path is local-only and not gated.

## Implementation references

- `apps/server/src/map-analysis/calcBundle.ts:maybePullCalcBundleOnBoot()` — boot dispatch (packaged → file, dev → Hub)
- `apps/server/src/map-analysis/calcBundle.ts:maybeApplyShippedCalcBundleOnBoot()`
- `apps/server/src/map-analysis/calcBundle.ts:reworkReplaceAlgorithmsForBoot()`
- `apps/server/src/map-analysis/calcBundle.ts:applyCalcBundle()` — sliced batched apply
- `apps/server/src/map-analysis/calcBundle.ts:buildCalcBundleFileBytes()`
- `apps/server/src/map-analysis/calcBundleFile.ts:readShippedCalcBundleFile()`
- `apps/server/src/routes/settings.ts` — `GET /settings/calc-bundle/export-file`
- `apps/server/public/features/hub/HubAdminCalcBundlesPage.tsx` — download + upload buttons
- `apps/desktop/main.js` — sets `ROXYSU_PACKAGED=1` only when `paths.isPackaged`, passes `ROXYSU_CALC_BUNDLE_FILE` when `resources/calc-bundle.ndjson.gz` exists
- `apps/desktop/scripts/after-pack.mjs` / `nix/package.nix` — stage the file into `resources/`
- `apps/server/src/routes/settings.ts` `POST /settings/calc-bundle/export-upload` — admin Hub upload
