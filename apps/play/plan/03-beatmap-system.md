# Beatmap System

## Goal

Convert an osu!lazer beatmap blob into a compact Roxysu gameplay representation.

## Pipeline

```text
beatmaps row
   ↓
hash
   ↓
AssetResolver
   ↓
.osu file
   ↓
BeatmapParser
   ↓
BeatmapChart
```

## Separate Models

Do not pass raw parser structures through gameplay.

Use:

```text
BeatmapMetadata
BeatmapDifficulty
BeatmapTiming
BeatmapObject
BeatmapChart
```

## Chart Representation

For mania, the runtime chart should contain efficiently accessible notes:

```ts
interface Note {
  lane: number;
  startTime: number;
  endTime?: number;
}
```

Add whatever timing/object metadata is actually required by gameplay.

## Parser Responsibilities

- Parse metadata
- Parse difficulty
- Parse timing
- Parse hit objects
- Normalize values
- Validate lane/object data
- Produce deterministic output

## Runtime Requirements

Gameplay should be able to:

- find upcoming notes
- find notes near a hit time
- identify holds
- identify misses
- iterate visible notes

Avoid repeatedly scanning the whole chart.

## Caching

Consider caching parsed charts by:

```text
beatmap ID + content hash
```

Invalidate when the hash changes.

## Error Handling

Reject or report:

- invalid syntax
- missing required fields
- unsupported object types
- invalid lane
- corrupt timing
- inconsistent data

## Deliverable

A parser that can load a real installed mania chart into a runtime-friendly immutable/mostly immutable representation.
