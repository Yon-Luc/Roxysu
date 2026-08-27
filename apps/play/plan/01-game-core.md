# Game Core

## Goal

Create the central runtime that coordinates game state, lifecycle, clock, update order, and system ownership.

## Responsibilities

- Game lifecycle
- State transitions
- System initialization/shutdown
- Update ordering
- Pause/resume/restart
- Loading boundaries

## State Machine

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
```

## API Shape

```ts
class Game {
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  finish(): void;
}
```

Keep the orchestration layer thin.

## Update Order

```text
read authoritative time
        ↓
process input
        ↓
update gameplay
        ↓
emit events
        ↓
update effects
        ↓
update presentation
```

## Important Rules

- No SQLite calls in the update loop.
- No beatmap parsing in the update loop.
- No React state for high-frequency state.
- Do not make gameplay depend on GPUIX frame rate.
- Explicitly handle lifecycle cleanup.

## Deliverable

A minimal Game object that can load, start, pause, resume, restart and finish a chart without requiring the final UI.
