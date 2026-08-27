# Audio & Timing

## Goal

Make audio playback and gameplay timing stable enough for a rhythm game.

## Principle

The gameplay timeline must be independent from UI animation timing.

Prefer:

```text
Audio position
    ↓
GameClock
    ↓
Gameplay
Playfield
Effects
```

## Audio API

```ts
load(track)
play()
pause()
stop()
seek(ms)
getPosition()
setVolume(value)
```

## Clock

```ts
interface GameClock {
  getTime(): number;
  start(): void;
  pause(): void;
  resume(): void;
  seek(timeMs: number): void;
}
```

The clock must define exactly what time means during loading, countdown, pause and seek.

## Synchronization

Measure and account for:

- audio startup latency
- output device latency if relevant
- seek behavior
- pause/resume drift
- rate changes if supported

## Preview vs Gameplay

Use separate control paths:

```text
PreviewController → AudioEngine
Gameplay → AudioEngine + GameClock
```

Do not contaminate gameplay state with song-select preview state.

## Deliverable

A testable audio clock where a note at 10,000 ms is judged against the same timeline that drives its visual position.
