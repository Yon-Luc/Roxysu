---
cand: D5
reopens: F-037
feature: desktop
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# Realm-reader respawn dead-ends when re-extract or the entry check fails

## Problem

`scheduleRealmRespawn` waits, then calls `spawnRealmReader`. If `ensureRealmExtracted` throws, or `paths.realmEntry` is missing, `spawnRealmReader` logs and returns. No further timer is scheduled. `realmRespawnFailures` advances only inside `scheduleRealmRespawn`, which these returns never call.

One extract or entry failure after a crash ends respawn until the process restarts. The same early return on the initial boot spawn was never on a timer, so a missing entry at launch also never retries.

A still-running child must not reschedule. That early return is a different case.

## Potential solution

`spawnRealmReader` returns `"running" | "failed" | "spawned"`.

```js
if (childIsAlive(realmChild)) return "running";
try {
  ensureRealmExtracted(paths);
} catch (err) {
  desktopLog(`realm extract failed: ${err}`);
  return "failed";
}
if (!fs.existsSync(paths.realmEntry)) {
  desktopLog(`realm entry missing: ${paths.realmEntry}`);
  return "failed";
}
// existing spawn
return "spawned";
```

The timer callback, and the initial call site, both do:

```js
if (spawnRealmReader(paths, sharedEnv) === "failed") {
  scheduleRealmRespawn(paths, sharedEnv);
}
```

`scheduleRealmRespawn` already no-ops when a timer is pending, and `decideRespawn` advances the counter and eventually gives up. Do not increment `realmRespawnFailures` inside `spawnRealmReader`. That would double-count.

Use the D1 `childIsAlive` helper for the running check so a signal-dead child is not treated as running.

## Do not

- Do not loop immediately on extract failure. The existing backoff is the retry. A tight loop on a missing binary is the thing F-037's give-up exists to stop.
- Do not schedule from the `"running"` return. That is the "already up" guard.

## Touch

- `apps/desktop/main.js` — `spawnRealmReader` return, the timer callback, the initial spawn call

## Tests

`respawnPolicy` already covers delay and give-up. Add a test only if the return value is extracted. Otherwise the change is the three return strings and the one `=== "failed"` call. A fake-fs test of `main.js` is not worth it.
