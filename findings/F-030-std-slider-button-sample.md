---
id: F-030
feature: preview-replay
kind: correctness
severity: medium
confidence: likely
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
