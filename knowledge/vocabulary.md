# Domain vocabulary

Canonical terms for Roxysu. Use these exact words in all knowledge documents.
If a concept is missing, add it here before using it elsewhere.

See also: forbidden terms in `.cursor/rules/knowledge-maintainer.mdc`.

---

### Realm

osu!lazer's `client.realm` file. Roxysu reads beatmaps and scores from it; the only intentional write is **collection write-back** to `!Roxysu`-prefixed rows.

**Not:** "the database", "osu db", "lazer db"

**See:** [architecture/realm-access.md](architecture/realm-access.md), [business/realm-read-only.md](business/realm-read-only.md)

---

### Local mirror

The shared SQLite file (`apps/server/data.sqlite` by default). Holds extracted Realm beatmaps/scores (raw import tables) plus derived analytics and user-authored rows (collections, settings, mastery, sessions).

**Not:** "cache", "local db", "copy", "database"

**In code:** `@roxysu/db` schema; dual clients `client.bun` / `client.node`

**See:** [architecture/local-mirror.md](architecture/local-mirror.md), [architecture/data-ownership.md](architecture/data-ownership.md)

---

### Hub store

The Hub's separate SQLite file (`hub.sqlite`). Holds shared collections and the hub search index — not the client app's practice mirror.

**Not:** "hub database", "hub cache"

**See:** [architecture/hub-vs-local.md](architecture/hub-vs-local.md), [features/hub/](features/hub/index.md)

---

### Collection

A saved query string representing a dynamic beatmap set. Matches are computed at read time, not stored as a static ID list. Optionally pushed to Realm via **collection write-back** as `!Roxysu {name}`.

**Not:** "playlist", "set", "library"

**See:** [features/smart-collections/](features/smart-collections/index.md)

---

### Realm extraction

Continuous import from Realm into the local mirror's raw import tables (watermark incremental, periodic reconcile, optional full remap). Formerly called "live sync" in UI and code filenames.

**Not:** "sync" alone, "mirror sync"

**In UI:** "Live sync" (Synced / Syncing / Paused / Failed)

**In code:** `apps/realm-reader/src/sync.ts`, setting key `sync.realm_reader_paused`

**See:** [features/live-sync/](features/live-sync/index.md), [flows/realm-extraction-to-ui.md](flows/realm-extraction-to-ui.md)

---

### Collection write-back

Manual push of smart collections from the local mirror into Realm `BeatmapCollection` rows. Requires pausing Realm extraction, backup, and lazer closed.

**Not:** "sync", "upload", "lazer sync"

**In code:** `POST /api/collections/sync-lazer`, `syncCollections.ts`, `packages/collection-sync`

**See:** [business/collection-lazer-sync.md](business/collection-lazer-sync.md), [flows/collection-write-back-to-lazer.md](flows/collection-write-back-to-lazer.md)

---

### Import

One completed Realm extraction cycle recorded in the local mirror's `imports` table. Signals new or changed scores for the analytics pipeline.

**Not:** "sync event", "data update"

**See:** [flows/realm-extraction-to-ui.md](flows/realm-extraction-to-ui.md)

---

### Raw import tables

Local mirror tables written only by realm-reader: `beatmaps`, `scores`, `imports`, mirrored realm collections, and related rows.

**See:** [architecture/data-ownership.md](architecture/data-ownership.md)

---

### Derived tables

Local mirror tables written only by the client app server: sessions, mastery, stats, score_metrics, collections, settings, notes, tags.

**See:** [architecture/data-ownership.md](architecture/data-ownership.md)

---

### Client app

The offline-capable product on the user's machine: `apps/server` + `apps/realm-reader` (+ optional `apps/desktop` shell). Serves practice analytics on `:4321` with no user auth.

**Not:** "local app", "local server", "local" alone

**See:** [architecture/hub-vs-local.md](architecture/hub-vs-local.md), [business/local-no-auth.md](business/local-no-auth.md)

---

### Hub

Separate networked process (`apps/hub`, `:4322`) for sharing collections and maintaining the hub search index. Uses osu! OAuth JWT.

**Not:** "online service" alone, "remote server" when meaning Hub specifically

**See:** [features/hub/](features/hub/index.md)

---

### Hub search index

Admin-managed pre-warmed beatmapset results in the Hub store. Each `search_cache` row is a **base prime** (`mode`, `status`, `key`, `sort`). Beatmapset stubs live in `search_index_sets` / `search_index_diffs` (legacy `beatmapset_ids` JSON is migrated on boot). Public `GET /search` looks up by base identity, applies secondary filters in SQL, and returns a page. `GET /search/all` dumps matching ids (or compact stubs) for count / download-all. Miss is empty — no live Hinamizawa proxy. Used by the download page — not part of the client app mirror.

**Not:** "search cache", "cache" alone

**In code:** `search_cache`, `search_index_sets`, `search_index_diffs`, hub admin routes, `apps/hub/src/services/searchIndex.ts`

**See:** [features/hub/](features/hub/index.md), [decisions/hub-search-base-index.md](decisions/hub-search-base-index.md)

---

### Hub tag

One canonical lowercase label from `HUB_TAGS_BY_MODE` / `VALID_TAGS` that a shared collection carries. Every tag belongs to a primary gamemode and is grouped under a category (Keys / Pattern / Style / Difficulty) for the picker. Mania pattern tags reuse Roxysu's pattern vocabulary (`jack`, `jumpstream`, `handstream`, `chordjack`, `bracket`, `chordstream`, `stream`, `delay`).

**Not:** "label", "category", "pattern name" when meaning a tag

**In code:** `packages/db/src/hub/schema.ts:HUB_TAG_GROUPS_BY_MODE`, `apps/server/public/lib/hub.ts:HUB_TAG_GROUPS_BY_MODE`

**See:** [features/hub/](features/hub/index.md)

---

### Collection match count store

Derived count of how many beatmaps match each collection query. Refreshed when collections or the library change.

**Not:** "match cache", "cache" alone

**In code:** `collectionMatchCache.ts`

**See:** [flows/create-collection.md](flows/create-collection.md)

---

### Sunny dan ratings store

Persisted mania difficulty estimates from the Sunny dan backfill job (`beatmap_dan_ratings` table). Powers `dan:` / `sunny:` query fields and 4K/7K recommendations. Nommod (rate 1.0, no chart conversion) estimates only.

**Not:** "dan cache", "cache" alone

**In code:** `beatmap_dan_ratings`, `sunnyDanJob.ts`

**See:** [features/sunny-dan-recommendations/](features/sunny-dan-recommendations/index.md)

---

### Dan difficulty variants

Persisted mod-aware mania difficulty estimates in `beatmap_dan_rating_variants`: one row per (beatmap, estimator, playback rate quantized to 2 decimals, full-LN Invert conversion) actually played. Computed by the dan variant background job after imports — never on request paths. NM plays stay in the Sunny dan ratings store.

**Not:** "mod cache", "variant cache", part of the Sunny dan ratings store

**In code:** `beatmap_dan_rating_variants`, `computeDanVariants.ts`, `danVariantJob.ts`, `resolveDanVariant()` (`packages/mania-judge`)

**See:** [features/sunny-dan-recommendations/](features/sunny-dan-recommendations/index.md), [flows/sunny-backfill-to-recommend.md](flows/sunny-backfill-to-recommend.md)

---

### Practice library

The searchable catalog of played beatmaps (practice cards). Filtered via the query language.

**Not:** "library data", "beatmap list" when meaning this product surface

**See:** [features/practice-library/](features/practice-library/index.md)

---

### Session

A contiguous group of scores in the local mirror, split when inactivity exceeds 30 minutes. Has a persisted **display name** for UI (not the numeric row id).

**Not:** "play group", "session id" when meaning the display label

**In code:** `sessions` table, `apps/server/src/analytics/session.ts`

**See:** [features/sessions/](features/sessions/index.md)

---

### Session display name

A stable, generated label for a session row (Mushoku Tensei–themed word combinations). Assigned from `session.id` via `@roxysu/session-names`, unique among other session display names in the local mirror, and stored in `sessions.name`. Always starts with a capital letter.

**Not:** "session title" (unless user-authored rename is added later)

**In code:** `generateSessionName()`, `packages/session-names/src/terms.json`

**See:** [features/sessions/](features/sessions/index.md)

---

### Query language

Shared DSL for practice search, collections, and global search. One parser/compiler/SQL path.

**In code:** `apps/server/src/query-language/`

**See:** [features/practice-library/](features/practice-library/index.md)

---

### Taiko playfield

The visual layer that draws don/kat notes, drumrolls, swells, and the receptor
for **taiko** (`rulesetShortName` `taiko`, Mode `1`). Scroll speed is a user skin
setting, not BPM/SV.

**Not:** "taiko notefield", converted Mode 0 maps played as taiko

**In code:** `TaikoPlayfield`, `paintTaikoPlayfield`, `roxysu:taiko-skin`

**See:** [features/preview-replay/](features/preview-replay/index.md)

---

### Catch playfield

The visual layer that draws fruits, droplets, bananas, and the catcher for
**catch** (`rulesetShortName` `fruits`, Mode `2`). Playfield is 512×384 like
standard. UI label is Catch; aliases `ctb` / `catch` exist only at filter edges.

**Not:** "ctb preview" as a separate product surface, converted Mode 0 maps played as catch

**In code:** `CatchPlayfield`, `paintCatchPlayfield`, `roxysu:catch-skin`

**See:** [features/preview-replay/](features/preview-replay/index.md)

---

### Imported mania skin

A user-provided osu! legacy skin (`.osk` or a folder with `skin.ini`) applied to
the mania notefield for beatmap preview and score rewatch. Sprites live in
IndexedDB; per-keymode layout metadata lives on the preview skin store.

**Not:** the procedural PreviewSkin editor (colors / shapes), lazer-native skins,
std/taiko/catch skins

**In code:** `maniaSkinImport.ts`, `osuSkinIni.ts`, `roxysu:preview-skin` `imported`

**See:** [features/preview-replay/](features/preview-replay/index.md)

---

### Score rewatch

Client-app playback of a stored score's replay frames and judgments against the
beatmap chart and audio (mania notefield, standard playfield, Taiko playfield, or
Catch playfield).

**Not:** "replay preview" alone, "video export", live **Play** mode in the modal

**In code:** `ScoreReplayModal`, `GET /api/scores/:id/replay`

**See:** [features/preview-replay/](features/preview-replay/index.md)

---

### Replay video export

Browser-side encode of a score rewatch into an MP4 (playfield + beatmap audio)
using mediabunny / WebCodecs. Supports mania, standard, taiko, and catch.
Runs offline in the client app; does not upload.

**Not:** "screen record", "replay render" on the server, "export" alone

**In code:** `apps/server/public/lib/replayVideoExport.ts`

**See:** [features/replay-video-export/](features/replay-video-export/index.md)

---

### Map marathon

A user-built mania chart made by concatenating several same-key-count maps from the practice library, with a configurable silence gap and a grid collage of their backgrounds, then imported into lazer as one `.osz`.

**Not:** Sunny dan ratings, a Collection, a playlist of separate maps

**In code:** `fuseManiaCharts`, `/marathon`, `POST /api/marathon/sources`, `POST /api/marathon/open-in-osu`

**See:** [features/map-marathon/](features/map-marathon/index.md)

---

### In-game overlay

Standalone Wayland host (`apps/overlay`) that draws the `/overlay` HUD page
above fullscreen osu!lazer via wlr-layer-shell (overlay layer, always
click-through). wlroots-family compositors only; data comes exclusively from
client-app HTTP (`GET /api/overlay`).

**Not:** the `/overlay` page alone (the OBS browser-source HUD), **Now selected**

**In code:** `apps/overlay/main.c`

**See:** [features/in-game-overlay/](features/in-game-overlay/index.md)

---

### Overlay profile

A named, saved layout for the `/overlay` HUD page: render size (width/height),
background mode (`solid`/`clear`), and positioned **Overlay elements**.
Persisted in the Settings HTTP store (`settings` key `overlay.profiles`, JSON
array) so every consumer — OBS browser source, Wayland host, browser tabs —
resolves the same layout. Selected via `#/overlay?profile=<id or name>`;
omitted → legacy single score-list rendering.

**Not:** the `/overlay` page itself, an **Overlay element**, a Now selected
layout (that one is page-local localStorage)

**In code:** `OverlayProfile`, `apps/server/src/overlay/profiles.ts`,
`apps/server/public/features/overlay-editor/`

**See:** [features/overlay-editor/](features/overlay-editor/index.md)

---

### Overlay element

One placed widget inside an Overlay profile, with canvas position (x/y), scale,
per-type options (score-list limit, preview height), and an optional **Overlay
trigger**. Extended set: `scoreList`, `identity`, `difficulty`, `livePlay`,
`preview`, `analysis`, `sessionStats`, `personalStats`, `density`. Unknown
types are dropped by server-side sanitization.

**Not:** a Now selected widget (localStorage-backed, order-only)

**In code:** `OverlayElementInstance`, `OVERLAY_ELEMENT_DEFS`
(`profileModel.ts`), renderers in `features/overlay/OverlayElements.tsx`

**See:** [features/overlay-editor/](features/overlay-editor/index.md)

---

### Overlay trigger

A simple per-element visibility condition evaluated client-side against the
**tosu live** snapshot (`play.active`, `status`, `connected`; op `is`/`isNot`;
action `hide`/`show`/`fade`). No nesting or AND/OR composition. Triggers gate
rendering only — never data fetching. A missing tosu snapshot leaves elements
visible.

**Not:** a rule engine, collection query

**In code:** `OverlayTrigger`, `elementTriggerState()` in `profileModel.ts`

**See:** [features/overlay-editor/](features/overlay-editor/index.md)

---

### Now selected

Client-app page that displays the in-game selected beatmap from **tosu live**, with optional embedded beatmap preview and mania pattern detail (pattern weights, density over time). Supports a Focus layout for a second monitor.

**Not:** Current session compact panel alone, OBS `/overlay`, score rewatch

**In code:** `apps/server/public/features/now-selected/`, `GET /api/tosu/live`, `GET /api/tosu/live/analysis`

**See:** [features/now-selected/](features/now-selected/index.md), [features/tosu-live/](features/tosu-live/index.md)

---

## Forbidden terms (quick reference)

| Avoid alone | Use instead |
|---|---|
| database | `Realm`, `local mirror`, or `Hub store` |
| service | `HTTP handler`, `domain service`, `repository`, or the specific module |
| sync | `Realm extraction`, `collection write-back`, `hub pull`, or name the direction |
| data | `beatmap`, `score`, `collection`, `import`, etc. |
| update | `edit` (user), `persist` (store write), `refresh` (background recompute) |
| cache | name the specific store (see above) or `local mirror` if persistent |
| local | `client app`, `offline`, or `local mirror` depending on meaning |
