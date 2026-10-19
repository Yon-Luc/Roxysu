---
id: F-038
feature: in-game-overlay
kind: logic-gap
severity: medium
confidence: verified
---

# Overlay URL changes wait out the crash respawn gap

## What

If the overlay child has exited and `overlaySpawnedAt` is less than 15 seconds ago, `apply()` returns before it compares the URL argument. A HUD URL change in that window is dropped until the next poll after the gap.

Turning the host off is not affected: the disable branch stops the child before the gap check.

## Why

The gap was added to avoid a crash loop. It wraps every apply, including a settings change, whenever the previous process has already exited. Knowledge describes settings restarts as bypassing that gap. The code does not.

## How to improve

Apply the gap only to liveness respawns where the URL is unchanged. If `nextArg` differs, stop and spawn immediately.

## Potential gain

Saving a new overlay URL after a crash takes effect on that save, not up to 15 seconds later.

## Evidence

- `apps/desktop/main.js` (lines 471–496): disable returns early and stops the child; the `OVERLAY_RESPAWN_GAP_MS` return sits after that and before the URL comparison.
