---
id: F3-035
feature: tosu-live
kind: logic-gap
severity: medium
confidence: verified
status: proposed
---

# Fixing the tosu executable path does not re-arm auto-start

## What

After 3 failed spawn attempts the gate gives up, and the warning tells the user to "Check the
tosu executable path and host in Settings". Saving a corrected path restarts the adapter but
never resets the gate, so nothing is retried. The same warning stays on screen until a
successful HTTP probe, which requires tosu to already be running, or a manual
`POST /api/tosu/start`.

Separately, a stale `lastPid` blocks spawns forever if the PID is recycled by an unrelated
process, because identity is inferred from `kill(pid, 0)`.

## Why

`restartTosuAdapter` -> `startTosuAdapter` never calls `resetSpawnGate`. Only
`requestTosuStart` and a reachable probe do, and the settings route routes a path change
through `restartTosuAdapter`. `decideSpawn` treats any live PID as "our tosu".

## How to improve

Call `resetSpawnGate(spawnGate)` at the top of `startTosuAdapter` when the executable path or
host changed - or always, since a restart is an explicit user action - and clear `lastPid` on a
spawn error.

Consider replacing the permanent give-up with a long cooldown. "Permanently broken until
restart" is a bad state for a setting the user just fixed.

## Evidence

- `apps/server/src/tosu/live.ts:393-432` - restart path
- `apps/server/src/tosu/live.ts:451-459` - the only resets
- `apps/server/src/routes/settings.ts:684-686` - path change goes to restart
- `apps/server/src/tosu/spawnGate.ts:45-69` - `decideSpawn`, PID reuse
