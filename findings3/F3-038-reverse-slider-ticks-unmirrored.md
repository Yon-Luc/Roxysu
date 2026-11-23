---
id: F3-038
feature: preview-replay
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Reverse-slider ticks are paired with the wrong path position

## What

`computeSliderTicks` emits every span's ticks with the same `frac`
(`tickOffset / spanDurationMs`), but the ball runs the path backwards on odd spans.

`simulateStdJudgments` then tests the cursor against `pathPointAt(path, tick.frac)` at
`tick.tMs`. On a reverse span the cursor is near `1 - frac`, not `frac`, so most reverse-span
ticks are scored `miss` - 30 accuracy points each, plus a combo break.

Single-reverse sliders are the most common standard slider shape, so rewatch and video-export
accuracy and combo are wrong on most maps that have repeats. The playfield paints the tick
dots' pass/fail colour from the same broken pairing.

## Why

`computeSliderTicks` loops over `repeats` and never mirrors on odd `s`. The repo's own ball
model does mirror: `bounceFracAt` returns `1 - local` when `seg % 2 === 1`, and the tail point
is chosen as `repeats % 2 === 1 ? 1 : 0`. Ticks and the ball disagree about where the ball is.

## How to improve

Mirror in the producer:
`frac: s % 2 === 0 ? tickOffset / spanDurationMs : 1 - tickOffset / spanDurationMs`.

Add a `slides: 2` case to the "computes timing-accurate slider ticks" test - every current
slider test uses `repeats: 1`, which is why the suite is blind - and a judgment test that puts
the cursor at the mirrored point.

## Evidence

- `packages/osu-chart/src/parseStd.ts:571-581` - ticks emitted unmirrored
- `apps/server/src/replay/stdJudge.ts:446-459` - cursor compared to `pathPointAt(path, tick.frac)`
- `apps/server/src/replay/stdJudge.ts:250-257` - `bounceFracAt` mirrors
- `apps/server/src/replay/stdJudge.ts:442` - tail point mirrors
- `apps/server/src/replay/std.test.ts:76-91`, `:213`, `:336`, `:416`, `:454` - all single-span

## Status

Fixed 2026-11-23. `computeSliderTicks` now mirrors the path fraction on odd spans
(`s % 2 === 0 ? local : 1 - local`), matching `bounceFracAt` and the tail-point rule.

Tests: `std.test.ts` "mirrors tick position on reverse spans" asserts the reverse span's
fractions are the mirror of the forward span's and that they still advance in time. Every
pre-existing slider test used `repeats: 1`, which is why the suite never caught it.
Full server suite green (1007 tests).
