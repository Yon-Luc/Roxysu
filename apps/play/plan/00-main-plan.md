# Roxysu Game — Main Architecture & Implementation Plan

## Goal

Build Roxysu's VSRG/game as a native GPUIX desktop application while reusing Roxysu's existing SQLite mirror and osu!lazer's hashed `files/` store.

The game should be modular: GPUIX owns presentation/rendering/input integration where appropriate, while Bun/TypeScript owns application, filesystem, database, parsing, gameplay, persistence, and orchestration logic.

A major architectural goal is **strong separation of concerns**.

Roxysu's game logic should not become permanently coupled to:

* osu!lazer's internal data structures
* Roxysu's database models
* GPUIX
* React
* filesystem layout
* audio implementation
* a specific rendering backend

Instead, these should be treated as **replaceable integrations around a generic VSRG/game engine**.

The long-term goal is that osu!lazer and Roxysu provide data through adapters/services, while the actual VSRG implementation operates on its own generic data structures.

---

# 1. Architectural Principles

## Separate responsibilities

### GPUIX

Responsible for:

* window/UI integration
* rendering integration
* input integration where appropriate
* presentation
* native desktop integration

GPUIX should not contain:

* SQLite queries
* beatmap parsing
* gameplay rules
* asset resolution
* Roxysu-specific business logic

---

### Bun/TypeScript

Responsible for:

* application logic
* filesystem access
* SQLite
* parsing
* services
* gameplay
* persistence
* orchestration
* game state
* data conversion
* integration adapters

---

### SQLite

Responsible for:

* persistent Roxysu catalog
* scores
* analytics
* mastery
* collections
* settings
* other persistent application data

SQLite is an application data source.

It should not become part of the VSRG renderer.

---

### osu!lazer `files/`

Responsible for:

* source binary assets
* `.osu` files
* audio
* backgrounds
* other hashed assets

Roxysu does not duplicate these files.

The rest of the application should access them through an asset abstraction rather than knowing the lazer filesystem layout.

---

### In-memory game state

Responsible for:

* high-frequency gameplay state
* current song time
* note states
* input state
* judgments
* combo
* score
* frame data
* effects

This state should not require React state updates every frame.

---

# 2. Separation of Concerns

This is one of the most important architectural requirements of the project.

The system should be divided into distinct layers:

```text
                    External Sources
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼
         osu!lazer      Roxysu       Other
         files/store    SQLite       sources
             │            │
             ▼            ▼
          Adapters / Repositories / Services
                     │
                     ▼
              Generic Game Data
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
     Game Systems          VSRG Engine
          │                     │
          │          ┌──────────┼──────────┐
          │          │          │          │
          │          ▼          ▼          ▼
          │       Timing    Visibility  Geometry
          │          │          │          │
          └──────────┴──────────┴──────────┘
                     │
                     ▼
               Game Events
                     │
                     ▼
              Rendering Layer
                     │
                     ▼
             PlayfieldDrawContext
                     │
             ┌───────┴────────┐
             ▼                ▼
           GPUIX         Future Native GPU
```

The important principle is:

> **External systems provide data and services; the game engine owns the domain logic.**

---

# 3. Dependency Direction

Dependencies should generally flow inward toward generic game/domain abstractions.

Prefer:

```text
osu!lazer
    ↓
LazerAdapter
    ↓
Generic Chart Data
    ↓
Gameplay / VSRG Engine
    ↓
Abstract Rendering Interface
    ↓
GPUIX
```

and:

```text
Roxysu SQLite
    ↓
Repository
    ↓
Generic Application Data
    ↓
Game Systems
```

Avoid:

```text
PlayfieldRenderer
       ↓
osu!lazer types
       ↓
Roxysu database
       ↓
GPUIX internals
```

The renderer should never need to know where a chart came from.

---

# 4. Adapter Boundaries

External representations should be converted at explicit boundaries.

For example:

```text
osu!lazer beatmap
       ↓
OsuLazerChartAdapter
       ↓
PlayfieldChart
```

Or:

```text
Roxysu database/chart
       ↓
RoxysuChartAdapter
       ↓
PlayfieldChart
```

The core VSRG implementation should only receive:

```ts
PlayfieldChart
```

It should not receive:

```ts
OsuBeatmap
HitObject
BeatmapDifficulty
RoxysuBeatmap
DatabaseBeatmap
```

or other application-specific structures.

This makes it possible to change the source without rewriting the VSRG engine.

---

# 5. Repository Structure

Target structure:

```text
apps/play/src/

├── app.tsx
│
├── game/
│   ├── Game.ts
│   ├── GameState.ts
│   ├── GameClock.ts
│   └── GameLoop.ts
│
├── database/
│   ├── RoxysuDatabase.ts
│   ├── BeatmapRepository.ts
│   ├── ScoreRepository.ts
│   └── SettingsRepository.ts
│
├── assets/
│   ├── AssetResolver.ts
│   ├── LazerAssetResolver.ts
│   └── LazerFileStore.ts
│
├── beatmap/
│   ├── Beatmap.ts
│   ├── BeatmapLoader.ts
│   ├── BeatmapParser.ts
│   ├── BeatmapChart.ts
│   └── BeatmapTiming.ts
│
├── audio/
│   ├── AudioEngine.ts
│   └── AudioClock.ts
│
├── input/
│   ├── InputManager.ts
│   ├── InputState.ts
│   └── KeyBindings.ts
│
├── gameplay/
│   ├── GameplayEngine.ts
│   ├── HitJudgment.ts
│   ├── HitWindows.ts
│   ├── HoldNoteController.ts
│   ├── ComboTracker.ts
│   ├── AccuracyTracker.ts
│   └── ScoreCalculator.ts
│
├── playfield/
│   └── [see 06-playfield-renderer.md]
│
├── effects/
│   ├── EffectManager.ts
│   ├── JudgmentEffects.ts
│   ├── LaneEffects.ts
│   └── ParticleSystem.ts
│
├── skin/
│   ├── Skin.ts
│   ├── SkinLoader.ts
│   └── SkinAssets.ts
│
├── results/
│   └── ResultsModel.ts
│
├── songselect/
│   ├── SongDatabase.ts
│   ├── SongScanner.ts
│   ├── SongSearch.ts
│   ├── SongSort.ts
│   └── DifficultySelector.ts
│
├── preview/
│   └── PreviewController.ts
│
├── settings/
│   ├── Settings.ts
│   └── SettingsStore.ts
│
└── events/
    ├── GameEvent.ts
    └── GameEventBus.ts
```

The exact structure may evolve, but the boundaries between systems should remain explicit.

---

# 6. Core Domain Independence

The core VSRG/game systems should ideally be usable without:

```text
React
GPUIX
osu!lazer
Roxysu SQLite
DOM
specific audio implementation
specific filesystem layout
```

For example, gameplay should conceptually be able to run as:

```text
Generic Chart
     ↓
GameplayEngine
     ↓
GameState
     ↓
GameEvents
```

without requiring a renderer.

Likewise, the playfield should be able to run as:

```text
Generic PlayfieldChart
     ↓
PlayfieldRenderer
     ↓
BenchmarkDrawContext
```

without requiring GPUIX or a GPU.

This allows individual systems to be tested and benchmarked independently.

---

# 7. Existing Roxysu Database

Reuse the existing database.

Important tables:

* `beatmap_sets`
* `beatmaps`
* `scores`
* `mastery`
* `collections`
* `realm_collections`
* `realm_collection_hashes`
* `tags`
* `beatmap_tags`
* `settings`
* `beatmap_mania_ratings`
* `beatmap_pattern_analysis`
* `beatmap_dan_ratings`
* `beatmap_dan_rating_variants`

Use repositories instead of direct DB access from UI.

The database is the metadata/index layer, not the binary asset store.

The VSRG engine should not directly depend on these database models.

---

# 8. Lazer Asset Store

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

The goal is that replacing osu!lazer's storage implementation only requires changing the asset adapter/resolver.

---

# 9. Game Flow

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

The game lifecycle should remain independent from the rendering backend.

---

# 10. Runtime Data Flow

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
Generic Beatmap / Chart
      ↓
┌─────────────────┬─────────────────┐
│                 │                 │
▼                 ▼                 ▼
Gameplay       Playfield         Audio
Engine         Renderer          Engine
│                 │                 │
▼                 ▼                 ▼
Events         visuals         Audio Clock
│                                   │
└─────────────────┬─────────────────┘
                  ▼
              Game State
```

The important boundary is the generic chart representation.

Neither gameplay nor rendering should need to know whether the chart originated from osu!lazer, Roxysu, or another source.

---

# 11. Core Systems

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

# 12. Critical Vertical Slice

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
convert to generic chart representation
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
VSRG playfield consumes generic chart/state
      ↓
GPUIX renders state
      ↓
score/result generated
```

This proves the architecture before large-scale polish.

---

# 13. Performance Rules

* Do not use React state for per-frame gameplay state.
* Do not allocate large objects every frame.
* Do not parse `.osu` during rendering.
* Do not query SQLite every frame.
* Do not resolve filesystem paths every frame.
* Do not make gameplay dependent on animation callbacks.
* Keep gameplay deterministic and time-driven.
* Use the audio timeline as the authoritative timeline where possible.
* Keep GPUIX rendering independent from database/application code.
* Keep VSRG logic independent from GPUIX.
* Keep VSRG logic independent from osu!lazer.
* Keep VSRG logic independent from Roxysu database models.
* Profile before optimizing.

---

# 14. Playfield Renderer Boundary

The playfield is a standalone VSRG rendering engine.

Its architecture should be:

```text
PlayfieldChart
      ↓
PlayfieldRenderer
      │
      ├── Timing
      ├── Visibility
      ├── Geometry
      ├── Effects
      └── Skin
      │
      ▼
PlayfieldDrawContext
      │
      ├── GpuixDrawContext
      └── BenchmarkDrawContext
```

The renderer should not directly depend on:

```text
React
osu!lazer
Roxysu database
GPUIX internals
```

See `06-playfield-renderer.md` for the detailed implementation plan.

The long-term goal is:

```text
PlayfieldRenderer
       ↓
PlayfieldDrawContext
       ↓
┌───────────────┬──────────────────┐
▼               ▼
GPUIX         Native GPU
```

The VSRG logic should remain unchanged when the backend changes.

---

# 15. Rendering/Data Independence

The playfield should operate on generic data:

```ts
interface PlayfieldChart {
  noteCount: number;
  startTime: Float64Array;
  endTime: Float64Array;
  lane: Uint8Array;
  type: Uint8Array;
}
```

This means:

```text
osu!lazer
     ↓
adapter
     ↓
PlayfieldChart
```

and:

```text
Roxysu
     ↓
adapter
     ↓
PlayfieldChart
```

both produce the same input to the renderer.

The renderer should not care which adapter produced it.

This is intentional.

---

# 16. Game Events as Decoupling Boundaries

Use the event system to prevent systems from directly depending on one another unnecessarily.

For example:

```text
GameplayEngine
      ↓
NoteHitEvent
      ↓
GameEventBus
      ├── ScoreCalculator
      ├── ComboTracker
      ├── AccuracyTracker
      ├── JudgmentEffects
      └── UI
```

Instead of:

```text
GameplayEngine
      ↓
directly manipulate
every other system
```

Events should communicate meaningful domain occurrences rather than raw rendering instructions.

For example:

```ts
NoteHitEvent
NoteMissEvent
HoldStartedEvent
HoldCompletedEvent
ComboChangedEvent
JudgmentEvent
GamePausedEvent
GameResumedEvent
```

Rendering systems can translate these events into visual effects without gameplay knowing how those effects are implemented.

---

# 17. Audio Boundary

Audio should also be treated as an implementation detail behind an interface.

Conceptually:

```text
Gameplay
    ↓
GameClock / AudioClock
    ↓
AudioEngine
```

The gameplay engine should consume authoritative time rather than depending on a specific audio library.

This allows the audio backend to eventually change without rewriting gameplay.

The preferred model is:

```text
Audio
  ↓
authoritative song time
  ↓
GameClock
  ↓
Gameplay
  ↓
Playfield
```

rather than allowing individual systems to maintain their own clocks.

---

# 18. Input Boundary

Input should be translated into generic game actions.

Prefer:

```text
Keyboard / GPUIX input
        ↓
InputManager
        ↓
Generic InputState
        ↓
GameplayEngine
```

rather than:

```text
GPUIX keyboard event
        ↓
GameplayEngine
```

This keeps gameplay independent from the UI/input implementation.

It also makes replay, testing, alternate input devices, and future native input implementations easier.

---

# 19. Effects and Presentation

Effects should consume gameplay events/state rather than owning gameplay logic.

For example:

```text
NoteHitEvent
      ↓
EffectManager
      ↓
JudgmentEffect
LaneEffect
ParticleEffect
```

The gameplay engine should not know whether a hit produces:

```text
GPUIX element
GPU particle
native shader
sound
animation
```

It only reports that a gameplay event occurred.

---

# 20. Skin Boundary

Skins should be data/configuration rather than being hardcoded into gameplay.

```text
Skin
 ↓
PlayfieldRenderer
 ↓
DrawContext
```

The renderer interprets the skin.

Gameplay should not depend on skin implementation.

A skin should be replaceable without modifying gameplay logic.

---

# 21. React as Application Controller

React should eventually act primarily as the application/controller layer.

It should control:

* play/pause
* selected map
* settings
* skin
* scroll speed
* window state
* menus
* song select
* results
* configuration

It should not control:

* individual notes
* note positions
* visibility
* hit detection
* per-frame gameplay
* timing calculations
* GPU draw calls

The desired relationship is:

```text
React
  │
  │ configuration / commands
  ▼
Game / Renderer
  │
  │ state / events
  ▼
React
```

rather than React being the actual gameplay/rendering engine.

---

# 22. Error Handling

Handle explicitly:

* missing beatmap blob
* missing audio blob
* corrupt `.osu`
* unsupported map format
* invalid timing data
* audio load failure
* database failure
* unsupported ruleset
* missing skin asset
* renderer failure

A map can exist in SQLite while its lazer blob is unavailable.

These states should be represented explicitly rather than causing unrelated systems to fail.

---

# 23. Testing Strategy

## Unit tests

* timing conversion
* hit windows
* judgment
* combo
* accuracy
* score
* hold-note behavior
* beatmap parsing
* chart conversion
* asset path resolution
* visibility
* geometry

## Integration tests

* DB → repository
* hash → lazer file
* beatmap → parsed chart
* source chart → generic chart
* audio → clock
* gameplay → events
* chart → playfield renderer
* renderer → benchmark backend

## Runtime tests

* pause/resume
* seek/restart
* missing assets
* long maps
* high object density
* 4K/high refresh rendering
* sustained gameplay sessions
* renderer without React
* gameplay without renderer
* chart loading without GPUIX

---

# 24. Detachability Tests

The architecture should eventually be validated by deliberately replacing individual integrations.

### Replace osu!lazer

```text
osu!lazer files
      ↓ remove
alternate asset provider
      ↓
same game systems
```

No VSRG/gameplay rewrite should be required.

### Replace Roxysu

```text
Roxysu SQLite
      ↓ remove
alternate chart/database provider
      ↓
same game systems
```

### Replace GPUIX

```text
GpuixDrawContext
      ↓ remove
NativeGpuDrawContext
      ↓
same PlayfieldRenderer
```

### Replace React

The core game should remain usable from another host:

```text
React
Native UI
Benchmark
Tests
Future GPUI surface
```

The purpose of these tests is to ensure that architectural boundaries are real rather than merely conceptual.

---

# 25. Milestones

## M1 — Foundation

Game state, clock, DB access, asset resolver.

## M2 — Beatmap Playback

Beatmap parser, generic chart representation, audio, input, basic gameplay.

## M3 — Playable Mania

Judgment, holds, combo, score, standalone playfield renderer.

## M4 — Game Shell

Song select, preview, results, settings.

## M5 — Roxysu Integration

Mastery, pattern analysis, mania ratings, collections, score history.

## M6 — Production Polish

Skins, effects, performance profiling, error recovery, persistence.

## M7 — Architecture Validation

Verify that:

* chart sources can be replaced
* asset providers can be replaced
* rendering backend can be replaced
* gameplay can run without rendering
* rendering can run without React
* VSRG logic contains no Roxysu database dependencies
* VSRG logic contains no osu!lazer-specific dependencies
* GPUIX-specific implementation is isolated

---

# 26. Performance Targets

The architecture should make performance measurable per layer.

Measure separately:

```text
Database
   ↓
Asset loading
   ↓
Parsing
   ↓
Chart preprocessing
   ↓
Gameplay
   ↓
Visibility
   ↓
Geometry
   ↓
Draw command generation
   ↓
GPUIX
   ↓
GPU
```

This prevents incorrectly attributing a bottleneck to the wrong subsystem.

For the playfield specifically:

```text
Renderer logic
< 0.25 ms typical
< 1 ms heavy scene
```

Normal rendering frames should perform:

```text
0 intentional allocations
```

or as close to zero as the runtime permits.

Visibility should be approximately:

```text
O(log N + V)
```

where:

```text
N = total notes
V = visible notes
```

rather than:

```text
O(N)
```

per frame.

---

# 27. Future Native Renderer

Do not implement a custom native renderer immediately.

First establish:

```text
PlayfieldRenderer
       ↓
PlayfieldDrawContext
       ↓
GpuixDrawContext
```

Once the VSRG logic and abstraction are stable, investigate:

```text
PlayfieldRenderer
       ↓
PlayfieldDrawContext
       ↓
NativeGpuDrawContext
       ↓
custom GPU implementation
```

The core VSRG implementation must remain unchanged.

---

# 28. Long-Term Architecture

The desired final architecture is:

```text
                           APPLICATION
                               │
                        ┌──────┴──────┐
                        │             │
                      React         Game
                        │             │
                        │             ▼
                        │       Game Systems
                        │             │
                        │      ┌──────┴──────┐
                        │      │             │
                        │   Gameplay      VSRG
                        │      │             │
                        │      │      ┌──────┼──────┐
                        │      │      ▼      ▼      ▼
                        │      │   Timing  Geometry Visibility
                        │      │      │      │      │
                        │      └──────┴──────┴──────┘
                        │                    │
                        │                    ▼
                        │             Draw Context
                        │                    │
                        │              ┌─────┴─────┐
                        │              ▼           ▼
                        │            GPUIX      Native GPU
                        │
                        ▼
                  UI / Presentation


DATA SOURCES
     │
 ┌───┴─────────────┐
 ▼                 ▼
osu!lazer        Roxysu
files/store      SQLite
 │                 │
 ▼                 ▼
Asset/Chart      Repositories
Adapters         / Services
 │                 │
 └───────┬─────────┘
         ▼
   Generic Game Data
```

The key property is that these are **replaceable boundaries**.

---

# 29. Definition of Done

The game is architecturally healthy when:

* `app.tsx` is mostly composition/UI.
* Gameplay can run without rendering.
* Playfield can render without knowing SQLite.
* Playfield can render without knowing osu!lazer.
* Asset resolution is centralized.
* Beatmap parsing is independent of GPUIX.
* Beatmap parsing produces generic chart data.
* Gameplay consumes generic chart data.
* VSRG rendering consumes generic chart data.
* Audio timing is authoritative.
* Game events connect systems without hard coupling.
* Existing Roxysu data is reused rather than duplicated.
* Missing lazer files are handled gracefully.
* Per-frame work is bounded and measurable.
* GPUIX-specific code is isolated behind rendering boundaries.
* React does not own per-frame gameplay state.
* The renderer does not depend on React.
* The core VSRG implementation does not depend on Roxysu.
* The core VSRG implementation does not depend on osu!lazer.
* The rendering backend can be replaced without rewriting VSRG logic.
* The chart source can be replaced without rewriting VSRG logic.
* The game can eventually operate with neither Roxysu nor osu!lazer as a fundamental dependency.

---

# 30. Final Architectural Principle

> **React controls the game, Roxysu/osu!lazer provide data, gameplay owns the rules, the VSRG engine owns the playfield logic, and GPUIX renders it.**

The desired data flow is:

```text
osu!lazer / Roxysu / other source
              ↓
           adapters
              ↓
       generic game data
              ↓
       gameplay / VSRG
              ↓
          game events
              ↓
       rendering commands
              ↓
       GPUIX / Native GPU
```

The goal is **not simply to organize the code into more files**.

The goal is to establish real architectural boundaries so that:

* Roxysu can be detached from the VSRG engine.
* osu!lazer can be detached from the VSRG engine.
* GPUIX can be replaced by another rendering backend.
* React can be replaced by another application host.
* The gameplay engine can run without rendering.
* The renderer can run without React.
* The playfield can be benchmarked without a GPU.
* Individual systems can be tested independently.

> **The VSRG engine should own the game domain, while Roxysu, osu!lazer, React, audio, and GPUIX remain integrations around it.**

This gives Roxysu a clean game-engine boundary now while preserving the option to evolve toward a fully native/custom GPU playfield later.
