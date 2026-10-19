---
id: F-006
feature: tosu-live
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Tosu auto-start can stack detached processes

## What

When the tosu HTTP probe is down and auto-start is allowed, the adapter calls `spawnTosu` every 60 seconds. The child is detached and unreferenced. The adapter does not record the pid or check that a previous spawn is still starting.

## Why

`spawnTosu` only checks that the executable path exists. A slow boot, a wrong port, or a process that binds late still looks like “HTTP down”, so the next probe starts another copy. Shutdown does not kill these children, by design of `detached: true`.

## How to improve

Remember the last spawned pid and skip spawn while that process is alive. Spawn only when nothing is listening on the configured host. Stop retrying after a small number of failures and surface that in the tosu warning list.

## Potential gain

One tosu process instead of a growing set of copies. Live overlay, Now selected, and the counter keep a single websocket source.

## Evidence

- `apps/server/src/tosu/spawn.ts` `spawnTosu` (lines 32–41): `detached: true`, `child.unref()`, pid returned and then dropped by the caller.
- `apps/server/src/tosu/live.ts` `refreshProbeAndMaybeSpawn` (lines 125–141): spawn when `!probe.httpUp` and `now - lastSpawnAttemptAt >= SPAWN_COOLDOWN_MS`.

## Status

Fixed. New pure gate `apps/server/src/tosu/spawnGate.ts` (`decideSpawn`, `recordSpawn`, `resetSpawnGate`): the spawned pid is remembered and a new spawn is skipped while it is alive (`process.kill(pid, 0)`); retries back off 60s/120s and stop after 3 consecutive attempts, with a warning in the live warnings list. A reachable HTTP probe or a manual `POST /api/tosu/start` resets the gate. `refreshProbeAndMaybeSpawn` in `apps/server/src/tosu/live.ts` uses it. Tests: `spawnGate.test.ts`, `live.probe.test.ts`.
