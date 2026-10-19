---
cand: B7
reopens: F-030
feature: preview-replay
kind: design-gap
severity: low
confidence: rejected
status: dropped
---

# Standard slider button edge is not a regression

## Why this is not a finding

`BUTTON_EDGE_LOOKBACK_MS` is 8. Each press or release is placed at `max(prev.tMs, frame.tMs - min(8, gap / 2))`. That is 0 to 8 ms before the recording frame. It is the documented F-030 fix: the replay records the frame that observed the change, so the edge time is an estimate. `knowledge/features/preview-replay` calls it that.

The tests assert judgment outcomes, not the timestamp. They pass for any lookback in a window around 8 ms. They do not lock 8 ms in, and they fail a lookback of 0. Setting the lookback to 0 would undo F-030.

Nothing in the repo says lazer stamps frames at the input event, or that the old previous-frame copy was exact. That half of the candidate was inference.

Do not reopen F-030. Do not change `BUTTON_EDGE_LOOKBACK_MS` unless a measured lazer replay shows the estimate is wrong. That measurement is not in this pass.
