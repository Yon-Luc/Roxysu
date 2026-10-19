---
id: F-030
feature: preview-replay
kind: correctness
severity: medium
confidence: likely
status: fixed
---

# Standard slider checks use the previous frame’s buttons

## What

`cursorAt` interpolates cursor x/y between replay frames and keeps `buttons` from the earlier frame. Slider tick and tail logic uses that sample to decide whether the key is held.

## Why

Replay frames are often ~16 ms apart. A press or release between frames is invisible until the next sample. Ticks in that gap can be judged with the wrong button state, which moves sim combo and accuracy on slider-heavy maps relative to the stored score.

## How to improve

Detect button edges on each frame pair and evaluate slider ticks against the button state that was active at the tick time, not the linearly mixed cursor’s copied buttons.

## Potential gain

Standard sim stays closer to the stored score on maps where sliders are the accuracy.

## Evidence

- `apps/server/src/replay/stdJudge.ts` `cursorAt` (lines 161–167): interpolated `x`/`y`, `buttons: a.buttons`.

## Status

Fixed. `replay/stdJudge.ts` no longer copies the previous frame's buttons onto the interpolated cursor. `buildButtonTimeline` derives press/release edges from the frames (each edge estimated up to 8 ms, at most half the gap, before the frame that records it) and `buttonsHeldAt` answers held-at-time for slider ticks and the tail end. Cursor interpolation is position only. Tests: three inter-frame press/release cases in `replay/std.test.ts`. Judgement call: the 8 ms edge lookback is an estimate, since a replay only records the frame where a change was observed.
