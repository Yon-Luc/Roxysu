---
last_verified: 2026-08
confidence: verified
touches:
  - apps/tosu-counter/
  - apps/tosu-counter/src/main.ts
  - apps/tosu-counter/src/live.ts
  - apps/tosu-counter/src/chart.ts
  - apps/tosu-counter/src/chartLoad.ts
  - apps/tosu-counter/src/settings.ts
  - apps/tosu-counter/src/tosuSettings.ts
  - apps/tosu-counter/src/folderSkin.ts
  - apps/tosu-counter/src/watermark.ts
  - apps/tosu-counter/src/pngShrink.ts
  - apps/server/public/lib/playfieldRaf.ts
  - apps/tosu-counter/public/index.html
  - apps/tosu-counter/public/metadata.txt
  - apps/tosu-counter/public/settings.json
  - apps/tosu-counter/scripts/build.ts
  - apps/server/public/lib/paintManiaNotefield.ts
  - apps/server/public/lib/clamp.ts
  - apps/server/public/lib/maniaSkinImport.ts
---

# Standalone tosu counter (mania notefield)

## Purpose

Ship the mania beatmap preview as a **Tosu counter**: a self-contained static
page served by tosu itself, usable with **no Roxysu install at all**. Draws the
mania notefield synced to the live in-game time.

## Business rules

1. The counter talks **only to tosu** — `ws://<host>/websocket/v2` for live
   frames and same-origin `GET /files/beatmap/file` for the current `.osu`
   text. It never contacts the client app, local mirror, or Realm.
2. Native mania Mode 3 only (`parser.gameMode === "3"`); converted maps show a
   placeholder, matching preview's native-mode rule.
3. Pattern-conversion mods follow preview order: **Invert then Hold Off**, then
   Mirror flips columns on the finished conversion. Flags come from raw tosu
   mod acronyms (`IN` / `HO` / `MR`).
4. The clock interpolates between tosu samples at the active rate; samples
   older than ~1.5s are treated as stale and the clock freezes (no audio, so
   no hard-resync path is needed).
5. Settings persist in browser localStorage (`roxysu:tosu-counter-settings`),
    overridable by URL params (`scroll`, `hitpos`, `cover`, `transparent`,
    `scale`, `hideplay`, `wm`) so
   OBS browser sources can pin a layout.
6. Rendering reuses the client app's pure paint modules
   (`paintManiaNotefield`, `previewSkin` defaults, `playfieldRaf`,
   osu-chart parser). No React ships in the bundle.
7. **Imported mania skins** resolve per keymode in order: folder pack →
   browser import (IndexedDB) → procedural fallback. The painter requires
   both a `KeymodeSkin.imported` layout and sprites to draw imported mode.
8. Folder pack: optional `skin/skin-pack.json` next to the counter
   (`{ name, layouts, sprites }`; sprite values are data URLs or paths
   relative to `skin/`). Exists because OBS browser sources cannot open file
   pickers and have isolated IndexedDB. The panel's **Export skin pack**
   button generates it from an in-browser `.osk` import via
   `exportImportedSpriteDataUrls()`. The build ships a placeholder `{}` pack
   so the boot probe gets a 200 — tosu otherwise logs an ENOENT error line
   for the missing optional file; `{}` validates as "no pack" (validation
   requires at least one sprite), and a real exported pack replaces it.
9. Browser import: drop an `.osk`/skin folder anywhere on the page or use
   **Import .osk** — same `maniaSkinImport` path as the client app, applied to
   all supported keymodes, persisted in IndexedDB on the tosu origin.
10. **tosu dashboard settings**: shipping `settings.json` registers scroll
    speed / hit position / lane cover / transparent background in the tosu
    dashboard. Values are read over `/websocket/commands`
    (`getSettings:<name>` with `?l=` identifying the counter) and live-updated
    on dashboard saves (`updateSettings` broadcasts). The identifier is the
    counter's **bare folder name** (`RoxysuPreview`, no slashes): tosu joins
    it into `<config>/settings/<name>.values.json`, so a slashed URL path
    (`/RoxysuPreview/`) silently becomes a non-existent `<name>/.values.json`
    sub-path — every settings read fails with an ENOENT log line from tosu
    ("Failed to parse counter settings") and sync never delivers values.
    Dashboard values win over URL params and localStorage once received; the
    in-page ⚙ panel stays as a standalone fallback and mirrors received
    values. The `getSettings` request is re-sent on a 1.5s retry until the
    first reply lands, because tosu may drop the request sent immediately on
    socket open — without the retry, saved dashboard values never reach the
    counter on load and the user must poke the dashboard to apply them.
    Extra dashboard fields: **playfield size** (`playfieldScale`, 20–100%),
    **hide while playing** (`hideWhilePlaying` — when tosu state is play,
    the page is fully transparent: html/body/stage backgrounds cleared and
    the notefield is `display:none`, otherwise a dark box remains in OBS),
    **import .osk** (`skinOskUrl` text — tosu has no
    file picker, so this is a URL or counter-relative path; drop on the
    preview still works), and **reset imported skin** (checkbox, rising
    edge). URL params `?scale=80&hideplay=1` pin size / hide-while-playing.
12. **Idle / song-select preview**: the notefield also renders while no
    beatmap is loaded (`chart.kind !== "ready"`) when `idlePreview` is on
    (default), drawing the empty playfield — receptors, lane cover, imported
    skin — so the skin is visible in song select instead of a blank
    "Waiting for osu!". The preview uses `lastColumnCount` (last loaded
    keymode, default 4). Toggle via dashboard setting, ⚙ panel checkbox, or
    localStorage (`roxysu:tosu-counter-settings`). Rendering is driven by
    `apps/server/public/lib/playfieldRaf.ts`, which paints on a `requestAnimation
    Frame` loop **plus** a ~30fps `setInterval` heartbeat that paints
    **unconditionally** (not change-gated) and paints synchronously on
    `invalidate()` + one forced paint at startup. The heartbeat must paint every
    tick rather than only on change: in idle (no live data) nothing changes, so
    a change-gated repaint would only fire once (while the embedded iframe may
    still be invisible) and never refresh once tosu shows it — the only thing
    forcing a repaint was a dashboard settings update. Unconditional heartbeat
    + startup paint keeps the canvas live inside embedded iframes (tosu dashboard
    preview reports `document.hidden` while visible, which otherwise
    throttles/pauses rAF). The counter also repaints on activation events
    (`load`, `pageshow`, `focus`, `resize`, `visibilitychange`) because the
    loop is suspended in tosu's embedded preview until the iframe is shown;
    and `connectTosuSettings` **always** repaints (`touchSkin`) on any
    dashboard frame for this counter — not only when values changed — since
    applying saved settings on load (the `getSettings` retry) removed the
    change that previously forced the repaint, leaving the canvas blank until
    a manual nudge.
11. **Roxysu watermark** ("like force export replay"): bottom-left logo +
    wordmark stamp drawn on the canvas after the notefield, mirroring the
    replay-video-export footer mark. On by default; toggleable via dashboard
    setting, ⚙ panel checkbox, or `?wm=0`. The build script downscales the
    1024px source art to `roxy-small.png` (64px) at build time using the pure
    TS PNG codec in `src/pngShrink.ts` (node:zlib inflate/deflate — fflate's
    inflate silently truncated this stream).

 13. **Live feed (`/websocket/v2`)** is global in tosu — it broadcasts to every
     connected client. Current tosu does **not** use `?v=`; when osu! isn't
     hooked the socket stays open and sends **nothing** (HTTP `/json/v2`
     returns `{error:"not_ready"}`). A 4s silent-socket close / version
     rotation was killing that idle connection and leaving the counter on
     `Song select (no osu link) · no frames`. `connectLiveSocket` now keeps
     `/websocket/v2` open and polls `/json/v2` until the websocket delivers.
     The v2 `beatmap.stats.cs` is an **object** `{original, converted}` (not a
     bare number); converted wins when it is a 1–10 key count. Title/version
     come from the live frame, not v1 `/json`. Chart identity (`loadedChecksum`)
     is committed only after a successful parse so a 4K→7K switch that briefly
     404s or still serves the old `.osu` can retry; a keys mismatch against
     `stats.cs` also reloads. Repeating frames must not reset the 250ms chart
     debounce (tosu polls ~100ms). An empty checksum idles only after ~500ms,
     not on a single blank frame during a map switch.

## Main flows

```
tosu /websocket/v2 frame (HTTP /json/v2 fallback if WS silent)
  ↓ checksum / flags / keys change (debounced 250ms; checksum committed on success)
GET /files/beatmap/file → OsuFileParser → modIN/modHO → Mirror flip → notes
  ↓ rAF loop on interpolated beatmap.time.live
paintManiaNotefield(canvas, sprites: folder pack > IndexedDB import > none)
```

## Install

- Build: `bun run --cwd apps/tosu-counter build` →
  `apps/tosu-counter/dist/RoxysuPreview/` + `RoxysuPreview.zip`.
- Users copy the folder into tosu's `static/` directory and open it from the
  tosu dashboard; the zip can also be hosted for tosu's dashboard downloader
  (`/api/counters/download/<url>`).

## Important symbols

- `apps/tosu-counter/src/live.ts` — reconnecting WS + `/json/v2` fallback + v2 frame mapping
- `apps/tosu-counter/src/chart.ts` — mania parse + IN/HO/MR flags
- `apps/tosu-counter/src/chartLoad.ts` — when to (re)fetch the current `.osu`
- `apps/tosu-counter/src/folderSkin.ts` — `skin/skin-pack.json` loader +
  validation (the OBS path; no file pickers there)
- `apps/server/public/lib/paintManiaNotefield.ts` — shared painter (now owns
  its `PreviewNote` type instead of importing from `lib/api.ts`; `clamp` moved
  to `lib/clamp.ts` so pure modules stay dependency-free)
- `apps/server/public/lib/maniaSkinImport.ts` — reused unmodified: draft
  building, IndexedDB store, sprite export for the pack generator

## Dependencies

- `packages/osu-chart` (`@roxysu/osu-chart/parser`)
- `features/preview-replay/` — painter, skin defaults, raf helpers

## Depended on by

- (entry surface; nothing depends on the counter)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Tosu counter
- [features/tosu-live/](../tosu-live/index.md) — Roxysu-side adapter (separate
  process path; the counter does not use it)
