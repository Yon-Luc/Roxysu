# Skin fusion: per-ruleset skin export (`.osk`)

Status: implemented (see "13. As built" for where the build deviates from this plan). Decisions confirmed by the owner:

- Delivery is a downloaded `.osk` only. The user imports it in lazer. No Realm write (see `knowledge/business/realm-read-only.md`).
- All rulesets are fusable: osu!, taiko, catch (`fruits`), mania (per key count), BMS. Taiko and BMS have no Roxysu import or preview today, so they are raw file copy only.

## 1. Goal

Let the user pick, per ruleset (and per mania key count), which **Realm skin** (or dropped `.osk` / folder) supplies that part. Roxysu builds one `.osk` that:

- carries every asset each donor needs for its slot,
- never lets two donors overwrite each other's files,
- keeps lazer's layout JSON (HUD / playfield / song select) per ruleset from the chosen donor.

## 2. What the current import does, and why export can't reuse it

Facts verified in source:

- `maniaSkinImport.ts`, `stdSkinImport.ts`, `catchSkinImport.ts` decode only the sprites Roxysu paints for previews (notes, receptors, stage, fruit, hitcircle, cursor, hit300...). They store them in IndexedDB under role keys (`7:notes:0`, `std:hitcircle`) and drop the original filenames, `@2x` variants, animation frames not used, hitsounds not used, fonts and everything else.
- Only a small slice of `skin.ini` is kept (`[Mania]` layout numbers, `[Colours]`, `[CatchTheBeat]`, `LayeredHitSounds`).
- The Skin page has no taiko or BMS import. `TaikoSkin` is a procedural colour/scroll config only.
- Layout JSON (`MainHUDComponents.json`, `Playfield.json`, `SongSelect.json`, `skininfo.json`) is mirrored in `realm_skin_files` but never read.

Consequence: exporting the IndexedDB contents would produce a skin missing the cursor, score digits, menu, sounds and layouts. Fusion must read the **whole source skin** (raw file map). The IndexedDB stores stay as the preview cache; fusion does not depend on them.

## 3. Real data that shapes the design

Observed in the local mirror (`realm_skins`, `realm_skin_files`) and lazer `files/` store:

- Layout JSON `DrawableInfo` is keyed by ruleset short name: `global`, `osu`, `taiko`, `fruits`, `mania`, plus BMS ruleset components (`osu.Game.Rulesets.BmsRuleset...`). `MainHUDComponents.json` mixes `global` and per-ruleset keys. `Playfield.json` has `osu` / `mania` / `fruits`. `SongSelect.json` is `global` only.
- Layout components can reference skin images by name (`SkinnableSprite` with `Settings.sprite_name`). The JSON therefore has file dependencies.
- Component `Type` strings embed the lazer assembly version (`Version=2025.1029.1.0`). They must be copied verbatim, never rewritten.
- `skininfo.json` holds `Name`, `Creator`, `InstantiationInfo` (`LegacySkin`, `ArgonSkin`, ...). Lazer-edited built-in skins ("... (modified)") have only 3 files (`skin.ini`, `skininfo.json`, `SongSelect.json`): they are layout-only overlays on a built-in instantiation, with no images.
- `skin.ini` is one file with `[General]`, `[Colours]`, `[Fonts]`, `[CatchTheBeat]`, and one `[Mania]` block per `Keys:`. Mania blocks reference images by backslash paths into subfolders (`NoteImage0: 7k\prayedit\mania-note2`).
- Some skins ship `1k.ini`..`8k.ini`, `Extra/...` folders, `.psd`, `.sfk`, `.gif`, `credits.txt`. All must be handled or deliberately skipped.

## 4. Merge model

### 4.1 Slots

```
FusionPlan
  base: skinRef                       // supplies skin.ini [General]/[Fonts]/shared assets + skininfo.json
  slots:
    osu            -> skinRef | base
    taiko          -> skinRef | base
    fruits (catch) -> skinRef | base
    mania.<N>k     -> skinRef | base   // one entry per Keys: value found in any donor, N = 1..18 or "all"
    bms            -> skinRef | base
    songSelect     -> skinRef | base   // SongSelect.json (global layout)
    hudGlobal      -> skinRef | base   // "global" key of MainHUDComponents.json
```

`skinRef` = `{ kind: "realm", id } | { kind: "archive", handle }`. "base" is itself a donor and is required.

### 4.2 Per-slot asset ownership (the part that avoids conflicts)

Each slot owns a file set computed from the donor's raw file map, not just from the IndexedDB roles.

- **mania.\<N\>k**: the donor's `[Mania]` block where `Keys == N`, plus every image that block can resolve, using the same candidate logic already in `osuSkinIni.ts` (`noteImageCandidates`, `keyImageCandidates`, `stageImageCandidates`) extended with the keys Roxysu doesn't preview today: `StageLight`, `LightingN`, `LightingL`, `Hit0..Hit300g`, `WarningArrow`, `NoteImage*T`, `KeyImage*D`, `Colour*` (values only), plus implicit defaults (`mania-note1/2/S`, `mania-key1/2/S[D]`, `mania-stage-*`, `mania-hit*`).
- **osu / fruits / taiko**: name-pattern ownership: `hitcircle*`, `approachcircle`, `cursor*`, `sliderb*`, `followpoint*`, `reversearrow`, `default-*`, `hit0/50/100/300*`, `spinner-*` for osu; `fruit-*`, `lighting`, catcher files for fruits; `taiko*`, `pippidon*`, `taikohitcircle*`, `taikobigcircle*`, `taiko-*` for taiko. Pattern tables live in one module so they are testable.
- **bms**: unknown asset naming. Must be read from the BmsRuleset source before implementation. Until then bms slot copies only its layout JSON entries and any file referenced by `sprite_name`, flagged `unknown` in the report.
- **layout slots**: JSON entries (not whole files, see 4.4) plus files named by `sprite_name`.
- **shared assets** (always from `base`, never per-slot): `score-*`, `combo-*`, `scorebar-*`, `menu-*`, `ranking-*`, `pause-*`, `fail-*`, `section-*`, `selection-*`, `welcome`, `count*`, `ready/go`, `inputoverlay-*`, `skin.ini [Fonts]`, and all hitsounds (`normal-/soft-/drum-` + `taiko-` prefixed) unless the user opts a slot into its own samples (see 7).

### 4.3 File name conflicts

Conflicts happen when two slots both want the same path with different bytes (for example `mania-note1.png` for 4K from skin A and 7K from skin B, or `hitcircle.png` for osu from A when the base also ships one).

Algorithm (all pure functions over `Map<path, bytes>`):

```
1. For each slot, resolve ownedFiles: Map<logicalRef, {path, bytes}> via the donor's candidate resolution (case-insensitive, @2x preferred, backslash normalised).
2. Hash each file (SHA-256; the lazer store already uses SHA-256 so Realm donors can reuse file_hash without reading bytes).
3. Build the output path table:
   - same path + same hash across slots -> write once.
   - same path + different hash -> conflict:
       a. if the file is a shared asset: base wins, others reported.
       b. otherwise move the losing slot's file under a namespaced folder
          `fusion/<slotId>/<original path>` and record a rewrite.
4. For every mania slot, ALWAYS emit explicit per-column image keys
   (NoteImageN/H/L/T, KeyImageN/D, StageLeft/Right/Hint/Bottom, Lighting*, Hit*)
   pointing at the final path. Never rely on implicit default names for a non-base slot,
   because defaults (mania-note1.png at the root) are global across keymodes.
5. Preserve @2x: if a donor has `x@2x.png`, emit both x.png and x@2x.png as a pair (or neither); never mix SD from one donor with HD from another.
6. Case: lazer/Windows lookups are case-insensitive. Two paths differing only by case are the same path for conflict purposes.
```

Rewrites live in `skin.ini` (paths use `\`, as lazer expects) or in layout JSON `sprite_name` values. Nothing else is rewritten.

### 4.4 `skin.ini` composition

Built from sections, not text concatenation:

- `[General]`, `[Fonts]`, `[Colours]`: from `base`. `Name` and `Author` are set by the fusion (see 5). Mode-specific `[General]` keys cannot be scoped by lazer, so they come from `base` too and the report lists those where a donor slot differs (for example `SliderBallFlip`, `CursorRotate`, `HitCircleOverlayAboveNumber`, `AnimationFramerate`).
- `Version:` is global and changes how lazer places legacy HUD elements and picks sprite variants. If donors disagree, the base value wins and the report raises a warning, because HUD placement for the other donors' modes may shift.
- `[CatchTheBeat]`: from the fruits donor.
- `[Mania]`: one block per `Keys:` value. Each block comes from that slot's donor, with image keys rewritten per 4.3. If two donors define the same `Keys:`, only the slot's donor block is emitted. Blocks for key counts no slot selects are dropped (or kept from base, see 7).
- Encoding: write UTF-8 with BOM only if the source had one; read with the existing `decodeSkinIniBytes`. Preserve unknown keys and comments inside the copied block.
- Colour keys that matter across modes: the combo colours come from `base` (they also drive catch and mania hold colours in lazer legacy lookups). If the fruits donor has different `[Colours]`, report only; do not merge.

Per-key files `1k.ini`..`8k.ini`: not read by lazer. Skipped and listed in the report.

### 4.5 Layout JSON composition ("respect the lazer layout")

Layout files are JSON with `DrawableInfo: { <ruleset>: [components] }`.

```
MainHUDComponents.json = { Version, DrawableInfo: {
    global:  from hudGlobal donor,
    osu:     from osu donor,
    taiko:   from taiko donor,
    fruits:  from fruits donor,
    mania:   from the mania donor of ... (see below),
    bms:     from bms donor
} }
Playfield.json     = same per-ruleset pick, same keys
SongSelect.json    = from songSelect donor (global only)
skininfo.json      = generated: Name, Creator, InstantiationInfo
```

Rules:

1. Copy each component entry verbatim (`Type`, `Position`, `Anchor`, `Settings`, `Children`). Never rewrite versions or reorder children.
2. Lazer's layout JSON is per ruleset, not per key count. Mania has one layout entry set. Use the donor of the **first-listed mania slot** by default, with a one-click "use the same donor for all mania layouts". The report shows which key counts disagree with the layout donor.
3. Components that reference sprites (`SkinnableSprite.Settings.sprite_name`) pull their file into that slot's owned set and follow 4.3.
4. A component whose `Type` comes from a ruleset that is not installed in the user's lazer (for example a BMS component without the ruleset) is kept: lazer ignores unknown components. Verify before implementation (section 8, item 1).
5. `Version` field: if donors differ, emit the highest and keep entries verbatim. Verify lazer's loader tolerates it.
6. Missing layout files in a donor mean "no layout override for that slot"; the entry is omitted, not an empty array, so lazer falls back to the skin's own default.

### 4.6 Layout-only donors (lazer "(modified)" skins)

A donor whose `instantiationInfo` is not `LegacySkin` (Argon, ArgonPro, Triangles, DefaultLegacySkin) has layouts but no images. Allowed as a donor for layout slots only. For image slots, Roxysu shows it as disabled with the reason. If such a skin is chosen as `base`, `InstantiationInfo` is still written as `LegacySkin` because the fused skin ships legacy images. Verify import behaviour in lazer (section 8, item 2).

## 5. Output

- File: `<name>.osk` (zip, no `skinfo`-style wrapper). Entry names are normalised relative paths only.
- Name: user-editable, default `Fusion <date>`. `skininfo.json.Name` and `skin.ini [General] Name` match. Creator: user-editable, default empty with a "Fusion of: A, B, C" line in `credits.txt`.
- `credits.txt`: lists each donor skin and its author per slot, as a licensing courtesy.
- `fusion-report.txt` is inside the zip: slots, donors, renamed files, dropped files, warnings. Not required by lazer.
- Size: stream files into `zipSync` via fflate (already a dependency on both client and server). A fusion of three 860-file skins is well under typical browser memory. Add a hard cap (for example 400 MB) with a clear error.

## 6. Architecture

- New pure module `apps/server/public/lib/skinFusion/`:
  - `fileMap.ts` (shared `normalizePath`, case-insensitive lookup, `@2x` pairs). The three import modules currently each copy `normalizePath`, `unzipSkinArchive`, `findSkinIniPath`, `lookupImage`. Extract to this shared module, with the importers calling it. Behaviour unchanged.
  - `iniModel.ts` (parse to sections preserving unknown keys and comments; serialise).
  - `ownership.ts` (per-slot file sets, name-pattern tables).
  - `layout.ts` (JSON compose and `sprite_name` deps).
  - `plan.ts` (`FusionPlan` -> `FusionResult { files, report }`).
  - `zip.ts` (safe path writer).
- Server (`apps/server/src/routes/skins.ts`): extend `GET /api/skins` with `instantiationInfo`, `hasLayout`, and the key counts and rulesets each skin provides (cheap: derived from `realm_skin_files` names plus a `skin.ini` read, memoised per `hash`). Keep `GET /:id/archive`. Fix the F-033 zip-slip issue here as a prerequisite (reject `..`, drive prefixes, absolute paths, and normalise `\`), and mirror the fix in `unzipSkinArchive`.
- Client: new Skin page section **Skin fusion** in `apps/server/public/features/settings/` (route key added in `settingsTabs.ts`), built from slot rows with a donor picker per slot (Realm skins list reuses `fetchRealmSkins`, plus drop `.osk` / folder reuse of `ManiaSkinDropHost` parsing), a live conflict preview, and a "Download .osk" action. Fusion runs in the browser (a Web Worker for hashing and zipping, so the UI stays responsive).
- No new tables. No settings keys needed in v1. Optionally persist the last plan as a JSON setting later.
- No Realm write, so `knowledge/decisions/` constraints are not touched.

## 7. Options (v1 defaults in bold)

- Hitsounds: **base only**; per-slot opt-in later.
- Mania key counts not selected by any slot: **drop their `[Mania]` blocks**; option "keep base's".
- Layout donor for mania: **first mania slot**; option "same as base".
- Dedupe identical files across donors: **on**.
- Keep `.psd`, `.sfk`, `Extra/`, `credits.txt` from donors: **drop**, listed in the report.

## 8. Unknowns (resolved against the lazer source)

Checked in a local lazer checkout (`osu.Game`, `osu.Game.Rulesets.*`):

1. **Unknown component `Type`:** lazer skips the WHOLE layout file for a ruleset if one component type cannot be resolved (for example a BMS component when the BMS ruleset is not installed). Layout JSON is still copied verbatim; the planner adds a warning when a composed entry uses a custom-ruleset type.
2. **`skininfo.json`:** lazer reads `Name`, `Creator`, `InstantiationInfo`. The `.osk` file name is not used as the skin name. A fused skin is written as a legacy skin (`osu.Game.Skinning.LegacySkin, osu.Game`).
3. **BMS:** the layout key is `bms` (custom ruleset short name). BMS asset names could not be verified (the ruleset is not in the lazer checkout), so BMS is a layout-only slot plus the base files; status `unknown`.
4. **Taiko / catch names:** taiko uses `taiko-*`, `taikohit*`, `taikobig*`, `pippidon*`; catch uses `fruit-*`, `lighting`, `scoreboard-explosion-*`. Taiko also reads shared `hitcircle`, `approachcircle`, `sliderscorepoint`, `spinner-*` which stay with the osu! slot.
5. **Subfolder mania images:** lazer returns the raw `[Mania]` value as the texture name, so `fusion/<donor>/...` paths resolve (backslash separators).
6. **`Version:`:** global; it changes mania behaviour below 2.5 (hit lighting scale). Kept as a warning, not a block. Layout `Version` is the LOWEST among contributing donors so lazer's own migrations still run.

## 9. Implementation phases

1. **Foundation**: shared `fileMap.ts`; zip-slip fix (F-033) in `skins.ts` and `unzipSkinArchive`; tests.
2. **Models**: `iniModel.ts` round-trip tests (real skins from the local mirror, comments, BOM, CRLF, duplicate `[Mania]`, backslash paths).
3. **Ownership**: mania per-key resolution (full keyset), osu/catch tables; taiko table after item 4.
4. **Layout composer**: per-ruleset pick, `sprite_name` deps, verbatim copy; golden-file tests.
5. **Conflict resolver and plan**: namespacing, `@2x` pairing, explicit `[Mania]` key rewrite, report. Tests: two donors with colliding `mania-note1.png`; same path same bytes; case-only difference; `@2x` mixed.
6. **API**: extend `/api/skins` list metadata.
7. **UI**: Skin fusion section, donor picker, conflict preview, download. i18n strings in `packages/i18n` (en + other dictionaries per `knowledge/features/client-ui-i18n.md`).
8. **Manual lazer check**: import the produced `.osk`; verify each ruleset renders its donor's assets and layout; verify mania 4K and 7K from different donors.
9. **BMS slot** once item 3 is verified.

## 10. Test plan

- Unit (bun test next to modules): `skinFusion/*.test.ts`; existing `maniaSkinImport.test.ts`, `stdSkinImport.names.test.ts`, `osuSkinIni.test.ts` must still pass after the shared extraction.
- Fixture skins are synthetic (small generated PNGs) so the repo stays small. A dev-only script can run the planner against the real mirror to print the report (no output to git).
- Property check: for every emitted `[Mania]` key referencing an image, the file exists in the zip. For every layout `sprite_name`, the file exists in the zip. No zip entry contains `..` or an absolute path.

## 11. Risks

- Skin authors' licences: fused skins may redistribute others' art. `credits.txt` helps; no automatic sharing in v1.
- `Version:` and global `[General]` keys cannot be scoped per ruleset. Warnings only.
- Large skins (860 files) make the conflict preview heavy: hash lazily, reuse Realm `file_hash`.
- Lazer version drift in layout component types: copy verbatim and report the donor's lazer version.

## 12. Knowledge base updates required with the change

- `knowledge/vocabulary.md`: add **Skin fusion**, **Fusion donor**, **Layout JSON** (lazer skin layout files). Clarify that **Realm skin** is now also a source for export, not only import.
- `knowledge/features/preview-replay/index.md`: pointer to the new feature.
- New `knowledge/features/skin-fusion/index.md` (Purpose, Business rules, Security rules for path normalisation, Dependencies: `preview-replay`, `live-sync` (for `realm_skins`)). Add to `knowledge/features/index.md`.
- New `knowledge/flows/export-fused-skin.md`.
- `findings/F-033-skin-archive-entry-names.md`: mark resolved when phase 1 lands.
- Update `todo.txt` Skin section.

## 13. As built

- Modules live in `apps/server/src/shared/skinFusion/` (not `public/lib/`) so server tests and the client both import them. Files: `fileMap.ts`, `iniModel.ts`, `ownership.ts`, `layout.ts`, `plan.ts`, `zip.ts`, `summary.ts`.
- The three importers were NOT refactored onto `fileMap.ts`; they keep their copies. The F-033 path fix uses `sanitizeZipEntryPath()`.
- Conflict namespace folder is per donor (`fusion/d<index>-<slug>/`), not per slot. Layout sprites that clash are renamed `name__<donorDir>.ext` and the layout JSON is rewritten.
- Mania image folders option: `auto` (isolate only when 2+ donors supply mania slots), `always`, `never`.
- Taiko-prefixed hitsounds belong to the taiko slot.
- Fusion runs on the main thread (no Web Worker); the plan preview is memoised and a 400 MB cap applies.
- UI: Skin page, "Fusion" tab (`SkinFusionEditor.tsx`); donors from Realm skins, `.osk`/`.zip`, or a folder.
- `GET /api/skins` now also returns `instantiationInfo`, `hasAssets`, `hasLayout`, `rulesets`, `keyCounts`.
- Still open: manual import of a produced `.osk` into lazer (phase 8) and BMS asset names (phase 9).
