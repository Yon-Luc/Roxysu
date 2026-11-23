---
id: F3-033
feature: tosu-live
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Tosu auto-start can kill the server process

## What

`spawnTosu` spawns a user-chosen binary and never listens for `'error'`. A failed exec
(ENOEXEC, EACCES, a Windows file that is not a real `.exe`) emits `'error'` asynchronously,
after the `try/catch` has already returned `ok: true`.

The unhandled `'error'` is an `uncaughtException`. The client app process exits. In the desktop
shell that is a server crash every probe cycle, which walks `decideRespawn`'s failure counter
to 6 and ends the session in the `respawn-exhausted` fatal dialog. At boot it presents as
`health-timeout`.

## Why

`spawnTosu` relies on `try/catch` around `spawn()`, which never throws for exec failures, and on
`child.pid == null` for detection. Neither `index.ts` nor `index.node.ts` installs an
`uncaughtException` handler; only `unhandledRejection` is handled.

## How to improve

Attach `child.on("error", ...)` before returning, turning it into `{ ok: false, warning }` and
running `recordSpawn` from that callback so the gate sees the failure.

Add a regression test that spawns a non-executable file. Consider an `uncaughtException`
handler as defence in depth, though the listener is the real fix.

## Evidence

- `apps/server/src/tosu/spawn.ts:28-39` - no error listener
- `apps/server/src/index.ts:31` - only `unhandledRejection`
- `apps/server/src/index.node.ts:35` - same
- `apps/server/src/tosu/live.ts:154-160` - caller trusts `ok`
- `apps/desktop/main.js:980-1004` - respawn policy that turns this into a fatal dialog

## Notes

Related in kind to D2, which added error listeners to the desktop's own children only.

## Status

Fixed 2026-11-23 (crash only). `spawnTosu` attaches `child.on("error", ...)` before returning
and reports through a new `SpawnTosuOptions.onError`. `live.ts` uses it to record the failure
in the spawn gate and surface the warning, guarded by the probe epoch so a stale error cannot
re-arm a stopped adapter.

Tests: `tosu/spawn.test.ts` - a non-executable regular file produces exactly one
`onError("Failed to start tosu...")` and does not crash; a missing path and a directory still
fail synchronously.

Not changed: the spawn-time `assertSafeExecutablePath(trimmed)` call still omits
`requireExecutable` / `rejectWorldWritable` / `rejectTempDir` that `PATCH /api/settings`
applies. Tightening it is a deliberate behaviour change (a settings row written by an older
build would stop spawning) and was left out of a crash fix.
