---
id: F-066
feature: in-game-overlay
kind: logic-gap
severity: low
confidence: verified
status: fixed
---

# A failed settings poll leaves the overlay host running

## What

`fetchOverlaySettings` resolves `null` on HTTP error or timeout. `apply()` returns immediately on null. It does not stop the child.

## Why

The disable branch only runs after a successful settings read. If the server is down while the user has turned the host off, the Wayland process keeps drawing until a later poll succeeds.

## How to improve

After repeated fetch failures, stop the host, or write the disable intent somewhere the desktop shell can read without the HTTP server.

## Potential gain

“Overlay off” survives a server restart instead of depending on the next successful poll.

## Evidence

- `apps/desktop/main.js` `fetchOverlaySettings` (lines 419–447): `resolve(null)` on error and timeout.
- `apply` (lines 467–468): `if (!overlaySettings || shuttingDown) return`.

## Status

Fixed. `decideOverlayApply` counts consecutive failed settings polls; after `OVERLAY_MAX_POLL_FAILURES` (5, about 20s at the 4s poll) it stops the host when the last successfully read `overlay.host_enabled` was off. If the last known value was on, or no read has succeeded yet, the host keeps running. A successful poll resets the counter. Files: `apps/desktop/overlayApplyPolicy.js`, `apps/desktop/main.js`. Tests: `apps/desktop/overlayApplyPolicy.test.js`.
