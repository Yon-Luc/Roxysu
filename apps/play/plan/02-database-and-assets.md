# Database and Assets

## Goal

Detect Roxysu, consume its shared SQLite catalog, and resolve osu!lazer file blobs on demand — without rebuilding a separate beatmap mirror or asset store.

---

## Roxysu Dependency

The game should detect whether Roxysu is installed and whether its database is available.

If Roxysu is not installed, the game should clearly explain that Roxysu is required to access the user's local osu!lazer beatmap library.

If Roxysu exists but has not synchronized yet, the game should explain that the user needs to sync Roxysu with osu!lazer before maps become available.

### Example flow

```text
Game starts
    ↓
Is Roxysu available?
    │
    ├── No
    │    ↓
    │  Show setup screen
    │    ↓
    │  "Install Roxysu to access your osu!lazer maps"
    │    ↓
    │  Install / Open Roxysu
    │
    └── Yes
         ↓
      Is database synced?
         │
         ├── No
         │    ↓
         │  "Sync Roxysu with osu!lazer"
         │
         └── Yes
              ↓
         Load beatmap library
```

The game should not silently fail with an empty song list when Roxysu is unavailable.

---

## First-Run Experience

On first launch, check:

- Is Roxysu installed?
- Can the game locate Roxysu's shared database?
- Is the database readable?
- Does it contain beatmaps?
- Can the configured osu!lazer data directory be located?
- Do referenced lazer blobs exist?

If Roxysu is missing, provide a clear action to install it.

If Roxysu exists but has not synchronized yet, provide a clear action/instruction to sync it.

### Example UI

```text
┌──────────────────────────────────────────┐
│             Roxysu required              │
│                                          │
│ Roxysu manages your osu!lazer beatmap    │
│ library and keeps the local beatmap      │
│ database synchronized.                   │
│                                          │
│ Install Roxysu and sync your osu!lazer   │
│ library to play your maps here.          │
│                                          │
│       [ Install Roxysu ]                 │
│       [ Open Roxysu ]                    │
│       [ Retry ]                          │
└──────────────────────────────────────────┘
```

The exact UI can be implemented later.

---

## Shared Database

The game and Roxysu should use the same SQLite database rather than maintaining separate copies.

### Conceptually

```text
                 Roxysu SQLite
                      │
             ┌────────┴────────┐
             │                 │
          Roxysu             Game
          server              │
             │                │
             ▼                ▼
       analytics          gameplay
       syncing            song select
       collections        results
       processing         statistics
```

The game should treat Roxysu-owned tables as an external/shared data source.

### Important rule

The game must not independently rebuild the beatmap mirror.

Roxysu remains responsible for:

- osu!lazer Realm extraction
- beatmap metadata synchronization
- hash discovery
- beatmap set synchronization
- score synchronization
- collection synchronization
- derived Roxysu analytics

The game consumes this information.

---

## Database Role

SQLite stores:

- beatmap metadata
- difficulty metadata
- hashes
- scores
- mastery
- collections
- analytics
- settings

Important fields include:

- `beatmaps.hash`
- `beatmaps.audioFileHash`
- `beatmaps.backgroundFileHash`
- `beatmaps.title`
- `beatmaps.artist`
- `beatmaps.difficultyName`
- `beatmaps.starRating`
- `beatmaps.bpm`
- `beatmaps.length`

---

## Repository Layer

Create:

- `BeatmapRepository`
- `ScoreRepository`
- `SettingsRepository`

### Example

```ts
beatmapRepository.getById(id)
beatmapRepository.search(filters)
beatmapRepository.getDifficulties(setId)
```

UI must not construct Drizzle queries.

The repository layer is the boundary between the game and Roxysu's database.

---

## Database Access Model

The game should preferably open the shared database in a way that does not interfere with Roxysu's synchronization process.

The implementation must account for:

- SQLite locking
- concurrent reads/writes
- Roxysu running while the game is open
- database migrations
- schema compatibility
- temporary sync states

The game should be primarily a read consumer of Roxysu-owned data.

Game-specific persistent data should use dedicated tables where necessary rather than modifying Roxysu's synchronization tables.

---

## Live Synchronization

Roxysu may continue synchronizing while the game is open.

The game should therefore tolerate the library changing underneath it.

### Example

```text
Game running
    │
    ▼
Roxysu sync starts
    │
    ▼
new beatmaps appear
    │
    ▼
Game refreshes Song Select
```

The game does not need to immediately reload everything.

A controlled refresh/invalidation mechanism should be used.

---

## Asset Layer

Create:

```ts
interface AssetResolver {
  resolveBeatmap(hash: string): string | null;
  resolveAudio(hash: string): string | null;
  resolveBackground(hash: string): string | null;
}
```

Implementation uses the lazer layout:

```text
{osuDataPath}/files/{h[0]}/{h[0:2]}/{h}
```

The game should obtain the osu!lazer data path from Roxysu/configuration where possible rather than requiring the user to manually configure it twice.

---

## Shared Asset Store

Roxysu does not own a second copy of the actual beatmap/audio files.

The actual assets remain in osu!lazer:

```text
osu!lazer
└── files/
    ├── a/
    ├── b/
    ├── ...
    └── ...
```

Roxysu stores references to those files through SHA-256 hashes.

The game follows the same references.

```text
SQLite
  │
  └── beatmaps.hash
          │
          ▼
AssetResolver
          │
          ▼
osu!lazer files/
          │
          ▼
actual .osu file
```

This prevents:

- duplicate beatmap storage
- duplicate audio storage
- unnecessary disk usage
- separate beatmap synchronization systems

---

## Missing Asset Model

Distinguish:

- Roxysu unavailable
- database unavailable
- metadata missing
- hash missing
- osu!lazer directory unavailable
- blob missing
- blob present

Do not assume that a DB row means the binary exists.

### Example

```text
Beatmap exists in Roxysu
        +
beatmaps.hash exists
        +
lazer blob missing
        ↓
Map unavailable
```

The UI should communicate this clearly instead of crashing.

---

## Loading Strategy

### Song Select

Use SQLite metadata only:

```text
SQLite
 ↓
BeatmapRepository
 ↓
Song Select
```

Do not load every `.osu`, audio file, or background just to populate Song Select.

### Playing

Only load the selected map:

```text
SQLite
 ↓
beatmap.hash
 ↓
AssetResolver
 ↓
.osu
 ↓
BeatmapParser
 ↓
Gameplay
```

### Audio

```text
SQLite
 ↓
audioFileHash
 ↓
AssetResolver
 ↓
audio file
 ↓
AudioEngine
```

### Background

```text
SQLite
 ↓
backgroundFileHash
 ↓
AssetResolver
 ↓
background image
```

---

## Sync Requirement

The game should explicitly communicate that Roxysu synchronization is what makes the osu!lazer library available to the game.

Recommended user-facing concept:

> Sync Roxysu with osu!lazer to import your local beatmap library.

The game should not attempt to replace Roxysu's Realm reader or build its own independent synchronization mechanism.

---

## Empty Library State

If Roxysu is installed but contains no synchronized beatmaps:

```text
No beatmaps available

Roxysu is installed, but your osu!lazer
library has not been synchronized yet.

Sync Roxysu with osu!lazer to make your
maps available here.

[ Open Roxysu ]
[ Refresh ]
```

---

## Deliverable

A reusable repository + asset abstraction that allows the game to:

- Detect Roxysu.
- Detect/access the shared SQLite database.
- Read the synchronized beatmap catalog.
- Reuse Roxysu's metadata and analytics.
- Locate the user's osu!lazer data directory.
- Resolve SHA-256 hashes to actual lazer files.
- Load `.osu`, audio, and background assets on demand.
- Handle missing/out-of-sync assets gracefully.
- Continue working while Roxysu performs synchronization.
- Avoid maintaining a duplicate beatmap database or asset store.

The final architecture should make Roxysu the library/synchronization layer and the game the gameplay/presentation layer.
