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

Admin-managed pre-warmed beatmapset results in the Hub store (`search_cache` table). Used by the download page — not part of the client app mirror.

**Not:** "search cache", "cache" alone

**In code:** `search_cache` table, hub admin routes

**See:** [features/hub/](features/hub/index.md), `roxysu-hub-plan.md`

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

Persisted mania difficulty estimates from the Sunny dan backfill job (`beatmap_dan_ratings` table). Powers `dan:` / `sunny:` query fields and 7K recommendations.

**Not:** "dan cache", "cache" alone

**In code:** `beatmap_dan_ratings`, `sunnyDanJob.ts`

**See:** [features/sunny-dan-recommendations/](features/sunny-dan-recommendations/index.md)

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

A stable, generated label for a session row (Mushoku Tensei–themed word combinations). Assigned from `session.id` via `@roxysu/session-names` and stored in `sessions.name`. Always starts with a capital letter.

**Not:** "session title" (unless user-authored rename is added later)

**In code:** `generateSessionName()`, `packages/session-names/src/terms.json`

**See:** [features/sessions/](features/sessions/index.md)

---

### Query language

Shared DSL for practice search, collections, and global search. One parser/compiler/SQL path.

**In code:** `apps/server/src/query-language/`

**See:** [features/practice-library/](features/practice-library/index.md)

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
