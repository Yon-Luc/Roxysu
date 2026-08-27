# Testing, Performance & Reliability

## Goal

Make the game reliable at high refresh rates and large charts.

## Unit Tests

Test:

- beatmap parsing
- timing
- hit windows
- holds
- combo
- accuracy
- score
- asset path resolution
- settings validation

## Integration Tests

Test:

```text
DB → repository
hash → lazer file
file → parser
audio → clock
input → gameplay
gameplay → events
```

## Deterministic Gameplay Tests

Create synthetic charts and synthetic input timestamps.

Expected result should be exact.

## Performance Tests

Measure:

- chart loading
- parser time
- audio startup
- gameplay update time
- renderer frame time
- allocations
- memory usage
- long-session stability

Test difficult cases:

- high object density
- long maps
- many simultaneous notes
- many effects
- high refresh rate
- large song libraries

## Reliability Tests

- missing `.osu`
- missing audio
- corrupted files
- invalid map data
- DB unavailable
- interrupted loading
- pause/resume
- restart
- rapid song switching

## Performance Rules

Never optimize based solely on intuition.

Measure first.

## Deliverable

A repeatable test suite and profiling workflow capable of detecting gameplay regressions and rendering regressions before release.
