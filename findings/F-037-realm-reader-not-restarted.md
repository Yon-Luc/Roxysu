---
id: F-037
feature: desktop
kind: logic-gap
severity: medium
confidence: verified
status: fixed
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

## Status

Fixed. `apps/desktop/main.js` now respawns realm-reader after an unexpected exit (not during `shutdown`) using the pure policy in `apps/desktop/respawnPolicy.js` (`decideRespawn`: exponential backoff 2s doubling to 60s, give up after 6 consecutive runs shorter than 60s; a run that stays up 60s resets the counter). The pending respawn timer is cleared in `shutdown()`. The spawn guard now checks `exitCode`/`signalCode` instead of `killed` (an exited child is never `killed`, which would have blocked the respawn). Every respawn and the give-up are written to the desktop log. Tests: `apps/desktop/respawnPolicy.test.js` (`bun test apps/desktop`). Not done: a UI "realm-reader down" indicator next to the sync indicator; the failure is in the desktop log only.
