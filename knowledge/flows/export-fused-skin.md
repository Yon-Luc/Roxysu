---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/features/settings/sections/SkinFusionEditor.tsx
  - apps/server/public/lib/skinFusionDonors.ts
  - apps/server/src/shared/skinFusion/plan.ts
  - apps/server/src/shared/skinFusion/zip.ts
  - apps/server/src/routes/skins.ts
---

# Export a fused skin

## User intent

Use different skins for different rulesets / mania key counts and install the
result in osu!lazer as one skin.

## Flow

```text
Skin page → Fusion tab
  → add Fusion donors
       ├── Realm skin:  GET /api/skins (list)  →  GET /api/skins/:id/archive
       ├── .osk / .zip: unzipSkinFiles()
       └── folder:      donorFromFileList()
     each → buildDonor()  (skin.ini model, layout JSON, key counts, rulesets)
  → pick base, slot donors, mania image folders mode
  → planFusion()  (memoised preview)
       ├── ownership per slot  → place files by priority
       ├── conflicts           → rename layout sprites / relocate mania refs
       ├── skin.ini + layout JSON + skininfo.json + credits.txt
       └── report: moved, left out, warnings
  → Download
       └── toOskBytes(files, formatReport())  → browser download <name>.osk
  → user imports the .osk in osu!lazer
```

## Business guarantee

- The `.osk` contains every file each slot's donor needs, with `skin.ini` and
  layout references pointing at files that exist in the archive.
- Each mania key count uses only its chosen donor's images; default-named root files
  never leak between key counts (auto namespacing).
- No Realm write; no upload.

## Implementation references

- `apps/server/src/shared/skinFusion/plan.ts:planFusion()`
- `apps/server/src/shared/skinFusion/zip.ts:toOskBytes()`
- `apps/server/public/features/settings/sections/SkinFusionEditor.tsx`
- `apps/server/public/lib/skinFusionDonors.ts:donorFromArchiveBytes()`

## Related knowledge

- [features/skin-fusion/](../features/skin-fusion/index.md)
- [features/preview-replay/](../features/preview-replay/index.md)
