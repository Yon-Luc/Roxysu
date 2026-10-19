---
last_verified: 2026-10-19
confidence: verified
touches:
  - apps/server/src/shared/skinFusion/fileMap.ts
  - apps/server/src/shared/skinFusion/iniModel.ts
  - apps/server/src/shared/skinFusion/ownership.ts
  - apps/server/src/shared/skinFusion/layout.ts
  - apps/server/src/shared/skinFusion/plan.ts
  - apps/server/src/shared/skinFusion/zip.ts
  - apps/server/src/shared/skinFusion/summary.ts
  - apps/server/src/shared/zipEntryPath.ts
  - apps/server/src/routes/skins.ts
  - apps/server/public/lib/skinFusionDonors.ts
  - apps/server/public/features/settings/sections/SkinFusionEditor.tsx
  - apps/server/public/features/settings/SkinPage.tsx
---

# Skin fusion

## Purpose

Build ONE `.osk` from several **Fusion donors**: each ruleset slot (osu!standard,
taiko, catch, BMS, each mania key count) takes its assets from the donor the user
picks, and the lazer **Layout JSON** is composed per ruleset from the same picks.
Plan and design rationale: `docs/skin-fusion-plan.md`.

## Business meaning

A player who likes one skin for 4K mania, another for 7K and a third for standard
can install a single skin in osu!lazer. Roxysu does the file-name conflict
handling and `skin.ini` / layout composition that would otherwise be manual.

## Business rules

1. Delivery is a downloaded `.osk` only. Fusion never writes to **Realm**
   (see `business/realm-read-only.md`).
2. A **Fusion donor** is a **Realm skin** (via `GET /api/skins/:id/archive`), a
   dropped `.osk` / `.zip`, or a folder. Fusion reads the raw file map, never the
   lossy **Imported mania skin** / **Imported standard skin** stores.
3. Slots: `base`, `osu`, `taiko`, `fruits`, `bms`, `songSelect`, `hudGlobal`,
   `maniaLayout`, and `mania:N` per key count. Unset slots follow the base donor.
   `None (game default)` (`NONE_DONOR`) leaves the slot empty.
4. Ownership of a file:
   - root-level name patterns decide osu / taiko / fruits / mania / shared /
     ignored (`ownership.ts:classifyFile()`); the slot's donor supplies them,
     shared files come from the base donor;
   - `[Mania]` image references are `AssetRef`s that may be relocated, with the
     `skin.ini` value rewritten;
   - Score / Combo digit prefixes are shared; the HitCircle prefix follows the osu slot.
5. Conflict priority, in placement order: shared base files, osu / taiko / fruits
   pattern files (never move; first writer wins), HitCircle prefix, layout
   sprites (renamed `name__<donorDir>.ext` and the layout rewritten), mania refs
   (relocated to `fusion/<donorDir>/<path>`). Identical bytes are deduplicated;
   paths compare case-insensitively; `@2x` and animation frames move as a group.
6. Mania image folders option: `auto` isolates every mania ref per donor only when
   2+ donors feed mania slots; `always`; `never`.
7. `skin.ini`: `[General]` and `[Fonts]` come from the base donor. Combo1–8 come
   from the selected combo-colour source (`base`, osu slot, or fruits slot);
   only keys that donor defines are written, so a single Combo1 is not filled
   out from the base. Std-only colour keys (`SliderBorder`, `SliderTrackOverride`,
   `SliderBall`, `SpinnerBackground`) come from the osu donor when it sets them.
   `[CatchTheBeat]` comes from the fruits donor; HyperDash keys that exist only
   under that donor's `[Colours]` are copied into `[CatchTheBeat]`. One `[Mania]`
   block per `Keys` (first block wins in lazer). `Version:` is global, so a
   mismatch yields a warning. Lazer has one combo palette for every ruleset, so
   a mismatch with the other slot is a warning, not a merge.
   `Name` is the user-edited name (default: source names joined). `Author` is
   the creator field, omitted when empty. The downloaded filename matches
   lazer's `Name (Author)` valid filename so import does not rename the skin.
8. Layout JSON (`MainHUDComponents.json`, `Playfield.json`, `SongSelect.json`):
   `DrawableInfo` entries are picked per ruleset key (`global`, `osu`, `taiko`,
   `fruits`, `mania`, `bms`) and copied verbatim, including `Type` strings. File
   `Version` is the LOWEST among contributing donors so lazer's migrations run.
   Layout-only donors (Argon / Triangles / Classic "(modified)", no assets) can feed
   layout slots and are disabled for image slots.
9. Output includes `skininfo.json` as a legacy skin, `credits.txt` and
   `fusion-report.txt`. Dropped files (`.psd`, `Extra/`, unclaimed files) are listed
   in the report.
10. Verified against lazer source: unknown component `Type` makes lazer skip the
    WHOLE layout file for that ruleset; `[Mania]` image values may contain
    sub-folders; first duplicate `Keys` block wins. BMS asset names are `unknown`
    (BMS ruleset source not available); only its layout key `bms` is used.

## Security rules

1. Archive entry names from donors and in the output must be safe relative paths
   (no `..`, absolute path, drive prefix, NUL). Unsafe names are skipped on read and
   rejected on write.
   **Enforced by:** `shared/zipEntryPath.ts:sanitizeZipEntryPath()`, used by
   `fileMap.ts:unzipSkinFiles()`, `zip.ts:toOskBytes()` and `routes/skins.ts` —
   status: verified by `shared/zipEntryPath.test.ts`, `plan.test.ts`.
   **Unauthorized result:** read: entry skipped; write: `toOskBytes` throws
   `Unsafe path in fused skin`.
2. Output paths must be unique case-insensitively.
   **Enforced by:** `zip.ts:toOskBytes()` — status: verified (`plan.test.ts`).
3. Output size is capped (400 MB default).
   **Enforced by:** `plan.ts:planFusion()` `maxBytes` — status: verified.
4. No Realm write, no server-side persistence: fusion runs in the client and the
   result is only a browser download.
   **Enforced by:** no write route exists; `routes/skins.ts` only exposes reads —
   status: verified.
5. No access control beyond the local-only model (`business/local-no-auth.md`).

## Main flows

- [flows/export-fused-skin.md](../../flows/export-fused-skin.md)

## Implementation

- Pure modules in `apps/server/src/shared/skinFusion/`; tests next to them.
- `routes/skins.ts` `GET /api/skins` lists `instantiationInfo`, `hasAssets`,
  `hasLayout`, `rulesets`, `keyCounts` (`summary.ts:summarizeSkin()`, memoised by
  skin id + hash).
- Client: Skin page "Fusion" tab, `SkinFusionEditor.tsx`; donors parsed by
  `lib/skinFusionDonors.ts`; i18n keys `skin.tabFusion`, `skin.fusion.*`.
- Runs on the main thread; plan is recomputed through `useMemo`.

## Important symbols

- `shared/skinFusion/plan.ts:planFusion()`, `buildDonor()`, `formatReport()`
- `shared/skinFusion/ownership.ts:classifyFile()`, `resolveManiaRefs()`
- `shared/skinFusion/layout.ts:pickLayoutEntries()`, `layoutVersion()`, `customRulesetTypes()`
- `shared/skinFusion/iniModel.ts:parseIni()`, `serializeIni()`
- `shared/skinFusion/zip.ts:toOskBytes()`

## Dependencies

- [features/preview-replay/](../preview-replay/index.md) — hosts the Skin page and `routes/skins.ts`.
- [features/live-sync/](../live-sync/index.md) — extracts `realm_skins` / `realm_skin_files`.
- `business/realm-read-only.md`

## Depended on by

- None yet. Changing `sanitizeZipEntryPath()` or `GET /api/skins` affects it.

## Side effects

None on the server. The browser downloads `<name>.osk`.

## Failure behavior

Planner errors (no base donor, over the size cap, unsafe or duplicate path) show
as an error line in the editor and disable Download. Unreadable donor archives are
reported when added.

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Skin fusion, Fusion donor, Layout JSON, Realm skin
- `findings/F-033-skin-archive-entry-names.md`
