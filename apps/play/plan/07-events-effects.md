# Events & Effects

## Goal

Decouple gameplay events from presentation effects.

## Event Bus

Example events:

```ts
NoteHit
NoteMiss
HoldStarted
HoldBroken
HoldCompleted
ComboChanged
Judgment
SongFinished
```

## Flow

```text
Gameplay
   ↓
GameEventBus
   ├── Playfield
   ├── Effects
   ├── UI
   └── Audio feedback
```

## Effects

Create:

```text
EffectManager
JudgmentEffects
LaneEffects
ParticleSystem
ScreenEffects
```

Effects should have their own lifetimes.

## Rule

Gameplay emits facts.

Presentation decides how those facts look.

Example:

```text
Gameplay: NoteHit(Perfect, lane=3)
```

Effects may turn that into:

```text
lane flash
judgment popup
particle burst
screen response
```

## Performance

Avoid creating hundreds of framework objects for tiny transient effects.

Prefer lightweight renderer-side state where possible.

## Deliverable

A hit event can trigger visual feedback without gameplay importing the renderer.
