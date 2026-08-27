# Input & Gameplay

## Goal

Build deterministic mania gameplay independent of rendering.

## Input

Create:

```text
InputManager
InputState
KeyBindings
```

Support:

```text
key down
key up
isHeld(lane)
```

Do not hardcode keyboard layouts.

## Gameplay Pipeline

```text
Input
  +
GameClock
  +
BeatmapChart
      ↓
GameplayEngine
      ↓
Judgment / Score / Combo
      ↓
GameEvents
```

## Judgment

Use configurable hit windows:

```ts
interface HitWindows {
  perfect: number;
  great: number;
  good: number;
  bad: number;
}
```

Calculate:

```text
delta = inputTime - noteTime
```

Then map delta to judgment.

## Misses

Miss processing must be time-driven, not render-driven.

A note becomes missable based on the gameplay clock.

## Holds

Track:

```text
press
hold active
release
completion
early release
```

Rendering should never decide whether a hold succeeded.

## Combo

Maintain combo from gameplay events.

## Accuracy

Keep raw counts:

```text
perfect
great
good
bad
miss
```

Calculate accuracy from those counts according to the selected ruleset/formula.

## Score

Keep scoring rules in a dedicated calculator.

## Determinism

Given:

```text
chart + input timestamps + settings
```

the gameplay result should be reproducible.

## Deliverable

A headless gameplay engine that can play a chart using synthetic input without GPUIX.
