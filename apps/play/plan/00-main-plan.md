# Roxysu Game — Main Architecture & Implementation Plan

## Goal

Build Roxysu's VSRG/game as a native GPUIX desktop application while reusing Roxysu's existing SQLite mirror and osu!lazer's hashed `files/` store.

The game should be modular: GPUIX owns presentation/rendering, while Bun/TypeScript owns application, filesystem, database, parsing, gameplay, persistence, and orchestration logic.

---

## 1. Architectural Principles

### Separate responsibilities

- **GPUIX:** window/UI/rendering/input integration where appropriate.
- **Bun/TypeScript:** application logic, filesystem, SQLite, parsing, services, orchestration.
- **SQLite:** persistent Roxysu catalog, scores, analytics, user data.
- **osu!lazer `files/`:** source of actual binary assets; Roxysu does not duplicate them.
- **In-memory game state:** high-frequency gameplay state and frame data.

### Dependency direction

```text
Lazer files + Roxysu DB
          ↓
    repositories/services
          ↓
      game systems
          ↓
       game events
          ↓
 rendering / UI / effects
```

Avoid having GPUIX components directly query SQLite or resolve lazer files.

---

# 2. Repository Structure

Target structure:

```text
apps/play/src/
├── app.tsx
├── game/
│   ├── Game.ts
│   ├── GameState.ts
│   ├── GameClock.ts
│   └── GameLoop.ts
├── database/
│   ├── RoxysuDatabase.ts
│   ├── BeatmapRepository.ts
│   ├── ScoreRepository.ts
│   └── SettingsRepository.ts
├── assets/
│   ├── AssetResolver.ts
│   ├── LazerAssetResolver.ts
│   └── LazerFileStore.ts
├── beatmap/
│   ├── Beatmap.ts
│   ├── BeatmapLoader.ts
│   ├── BeatmapParser.ts
│   ├── BeatmapChart.ts
│   └── BeatmapTiming.ts
├── audio/
│   ├── AudioEngine.ts
│   └── AudioClock.ts
├── input/
│   ├── InputManager.ts
│   ├── InputState.ts
│   └── KeyBindings.ts
├── gameplay/
│   ├── GameplayEngine.ts
│   ├── HitJudgment.ts
│   ├── HitWindows.ts
│   ├── HoldNoteController.ts
│   ├── ComboTracker.ts
│   ├── AccuracyTracker.ts
│   └── ScoreCalculator.ts
├── playfield/
│   └── [see 06-playfield-renderer.md]
├── effects/
│   ├── EffectManager.ts
│   ├── JudgmentEffects.ts
│   ├── LaneEffects.ts
│   └── ParticleSystem.ts
├── skin/
│   ├── Skin.ts
│   ├── SkinLoader.ts
│   └── SkinAssets.ts
├── results/
│   └── ResultsModel.ts
├── songselect/
│   ├── SongDatabase.ts
│   ├── SongScanner.ts
│   ├── SongSearch.ts
│   ├── SongSort.ts
│   └── DifficultySelector.ts
├── preview/
│   └── PreviewController.ts
├── settings/
│   ├── Settings.ts
│   └── SettingsStore.ts
└── events/
    ├── GameEvent.ts
    └── GameEventBus.ts
```

---

# 3. Existing Roxysu Database

Reuse the existing database.

Important tables:

- `beatmap_sets`
- `beatmaps`
- `scores`
- `mastery`
- `collections`
- `realm_collections`
- `realm_collection_hashes`
- `tags`
- `beatmap_tags`
- `settings`
- `beatmap_mania_ratings`
- `beatmap_pattern_analysis`
- `beatmap_dan_ratings`
- `beatmap_dan_rating_variants`

Use repositories instead of direct DB access from UI.

The database is the metadata/index layer, not the binary asset store.

---

# 4. Lazer Asset Store

Roxysu stores SHA-256 hashes and resolves actual bytes from osu!lazer.

For a hash `h`, the existing layout is:

```text
{osuDataPath}/files/{h[0]}/{h[0:2]}/{h}
```

The game should use an abstraction:

```ts
interface AssetResolver {
  resolveBeatmap(hash: string): string | null;
  resolveAudio(hash: string): string | null;
  resolveBackground(hash: string): string | null;
}
```

Never spread lazer path knowledge through the renderer/gameplay code.

Missing blobs must be a first-class state.

---

# 5. Game Flow

```text
BOOT
 ↓
SONG_SELECT
 ↓
LOADING
 ↓
COUNTDOWN
 ↓
PLAYING
 ↕
PAUSED
 ↓
RESULTS
 ↓
SONG_SELECT
```

`Game` orchestrates systems; it should not contain all implementation details.

---

# 6. Runtime Data Flow

```text
SQLite metadata
      ↓
BeatmapRepository
      ↓
BeatmapLoader
      ↓
LazerAssetResolver
      ↓
.osu blob
      ↓
BeatmapParser
      ↓
BeatmapChart
      ↓
┌───────────────┬──────────────┐
│ Gameplay      │ Playfield    │
│ Engine        │ Renderer     │
└───────┬───────┴──────┬───────┘
        ↓              ↓
      Events        visuals
```

Audio follows the same asset-resolution boundary.

---

# 7. Core Systems

Implement in this order:

1. Game Core / lifecycle
2. Game Clock
3. Roxysu DB repositories
4. Lazer Asset Resolver
5. Beatmap Loader / Parser
6. Audio Engine / Audio Clock
7. Input System
8. Gameplay / Judgment
9. Playfield Renderer
10. Event Bus
11. Effects
12. Score / Accuracy
13. Skin System
14. Results
15. Song Select
16. Preview
17. Persistence / settings
18. Polish / profiling

Detailed plans are in the numbered documents in this directory.

---

# 8. Critical Vertical Slice

Before building a complete UI, make this path work:

```text
select one beatmap
      ↓
load metadata
      ↓
resolve .osu hash
      ↓
parse chart
      ↓
resolve audio hash
      ↓
start audio
      ↓
audio clock drives gameplay
      ↓
input judges notes
      ↓
events generated
      ↓
GPUIX playfield renders state
      ↓
score/result generated
```

This proves the architecture before large-scale polish.

---

# 9. Performance Rules

- Do not use React state for per-frame gameplay state.
- Do not allocate large objects every frame.
- Do not parse `.osu` during rendering.
- Do not query SQLite every frame.
- Do not resolve filesystem paths every frame.
- Do not make gameplay dependent on animation callbacks.
- Keep gameplay deterministic and time-driven.
- Use the audio timeline as the authoritative timeline where possible.
- Keep GPUIX rendering independent from database/application code.
- Profile before optimizing.

---

# 10. Error Handling

Handle explicitly:

- missing beatmap blob
- missing audio blob
- corrupt `.osu`
- unsupported map format
- invalid timing data
- audio load failure
- database failure
- unsupported ruleset
- missing skin asset
- renderer failure

A map can exist in SQLite while its lazer blob is unavailable.

---

# 11. Testing Strategy

### Unit tests

- timing conversion
- hit windows
- judgment
- combo
- accuracy
- score
- hold-note behavior
- beatmap parsing
- asset path resolution

### Integration tests

- DB → repository
- hash → lazer file
- beatmap → parsed chart
- audio → clock
- gameplay → events

### Runtime tests

- pause/resume
- seek/restart
- missing assets
- long maps
- high object density
- 4K/high refresh rendering
- sustained gameplay sessions

---

# 12. Milestones

## M1 — Foundation

Game state, clock, DB access, asset resolver.

## M2 — Beatmap Playback

Beatmap parser, audio, input, basic gameplay.

## M3 — Playable Mania

Judgment, holds, combo, score, playfield.

## M4 — Game Shell

Song select, preview, results, settings.

## M5 — Roxysu Integration

Mastery, pattern analysis, mania ratings, collections, score history.

## M6 — Production Polish

Skins, effects, performance profiling, error recovery, persistence.

---

# 13. Definition of Done

The game is architecturally healthy when:

- `app.tsx` is mostly composition/UI.
- Gameplay can run without rendering.
- Playfield can render without knowing SQLite.
- Asset resolution is centralized.
- Beatmap parsing is independent of GPUIX.
- Audio timing is authoritative.
- Game events connect systems without hard coupling.
- Existing Roxysu data is reused rather than duplicated.
- Missing lazer files are handled gracefully.
- Per-frame work is bounded and measurable.
