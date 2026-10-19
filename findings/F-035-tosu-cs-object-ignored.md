---
id: F-035
feature: tosu-live
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# Tosu v2 key count ignores `stats.cs` objects

## What

The server adapter reads mania key count with `asFinite(bm?.stats?.cs)`, which only accepts a number. Current tosu v2 sends `stats.cs` as `{ original, converted }`. The standalone counter already handles that object.

## Why

Converted or keymode-changed maps then get a null key count in the live snapshot. Overlay identity and any analysis that branches on column count follow that null.

## How to improve

Use the counter’s `keysFromCs` (prefer integer `converted` in 1–10, else `original`) inside `parseTosuV2Message`.

## Potential gain

Now selected and the overlay show the key count the player is actually on.

## Evidence

- `apps/server/src/tosu/client.ts` (about lines 147–162): `const keys = asFinite(bm?.stats?.cs)`.
- `apps/tosu-counter/src/live.ts` `keysFromCs` (lines 83–98): object form with `converted` and `original`.

## Status

Fixed. Added exported `keysFromCs` (number or `{ original, converted }`, converted preferred when an integer 1-10) to `apps/server/src/tosu/client.ts` and used it in `parseTosuV2Message`. Tests in `apps/server/src/tosu/client.test.ts`.
