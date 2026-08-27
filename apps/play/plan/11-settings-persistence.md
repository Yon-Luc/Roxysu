# Settings & Persistence

## Goal

Centralize user configuration and durable game data.

## Settings

Categories:

```text
Gameplay
Controls
Audio
Graphics
Skin
```

Examples:

```text
scroll speed
hit offset
lane count where applicable
visual offset
key bindings
master/music/effect volume
effect quality
skin
```

## Storage

Existing `settings` table can be reused for generic persisted settings.

Use typed validation at the application boundary.

## Rules

- Load settings once or through controlled subscriptions.
- Never query SQLite every frame.
- Cache settings in memory.
- Persist changes asynchronously/debounced where appropriate.

## Game-Specific Data

Prefer dedicated tables for new durable game concepts rather than overloading unrelated tables.

## Deliverable

A typed settings service with defaults, validation, load/save, and migration support.
