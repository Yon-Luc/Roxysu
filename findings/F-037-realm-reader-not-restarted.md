---
id: F-037
feature: desktop
kind: logic-gap
severity: medium
confidence: verified
---

# Realm-reader is not restarted after it exits

## What

Desktop starts realm-reader once after the UI loads. The `exit` handler logs the code and signal. It does not respawn. The overlay host, by contrast, is polled and restarted.

## Why

A crash or a single-instance collision stops extraction while the window stays open. Scores and sessions drift from lazer until the user quits the whole app. The UI has no “realm-reader down” state for this path.

## How to improve

Respawn with backoff on unexpected exit, and surface the failure next to the sync indicator. Do not respawn during `shutdown`.

## Potential gain

A reader crash recovers without a full desktop restart.

## Evidence

- `apps/desktop/main.js` `spawnRealmReader` (about lines 323–358): `exit` handler only calls `desktopLog`.
- Startup (about lines 718–724) calls `spawnRealmReader` once, then `watchOverlayHostSetting`, which does poll.
