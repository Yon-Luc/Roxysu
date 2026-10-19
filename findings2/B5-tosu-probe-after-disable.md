---
cand: B5
feature: tosu-live
kind: correctness
severity: low
confidence: verified
status: proposed
---

# An in-flight tosu probe can spawn tosu after live is disabled

## Problem

`refreshProbeAndMaybeSpawn` checks `settings.enabled` once, then awaits `probeTosuHttp`. After the await it may call `spawnTosu` and it always assigns `warnings`.

Disabling goes through `restartTosuAdapter` → `startTosuAdapter`. That path reloads settings, and if disabled it clears `warnings` and returns. It does not cancel a probe that already passed the pre-await check. `stopTosuAdapter` does not clear `settings.enabled` either. The settings toggle is the path that does.

A probe started with `allowSpawn: true` (`runProbeTick`, websocket `onClose`, `requestTosuStart`) can start tosu after the user turned it off. A probe with `allowSpawn: false` (websocket `onOpen`) can still write the old warning list back.

## Potential solution

A generation counter, bumped before any await in `startTosuAdapter` and `stopTosuAdapter`. Capture it with the host and executable path before `probeTosuHttp`. After the await, bail out with no spawn and no `warnings` write if the generation moved, settings reloaded as disabled, or `dbRef` is gone.

```ts
let probeEpoch = 0;

export async function startTosuAdapter(db: Db): Promise<void> {
  const epoch = ++probeEpoch;
  dbRef = db;
  settings = await readTosuSettings(db);
  if (epoch !== probeEpoch) return;
  // existing disabled / enabled body
}

export function stopTosuAdapter(): void {
  probeEpoch += 1;
  // existing teardown
}

async function refreshProbeAndMaybeSpawn(opts: { allowSpawn: boolean }) {
  if (!settings?.enabled || !dbRef) return;
  const epoch = probeEpoch;
  const host = settings.host;
  const executablePath = settings.executablePath;
  const probe = await deps.probeTosuHttp(host);
  if (epoch !== probeEpoch || !settings?.enabled || !dbRef) return;
  // spawn and warnings assignment unchanged, using executablePath
}
```

The bump has to be the first line of `startTosuAdapter`. `readTosuSettings` is itself an await. An old probe must see the new epoch before that read finishes.

Do not clear `warnings` in the bail-out. The start/stop path that bumped the epoch already set the state the user asked for.

## Do not

- Do not add an AbortSignal to `probeTosuHttp` unless that helper already takes one. The epoch check is enough and does not change the probe client.
- Do not skip the spawn on a live adapter. Only a moved epoch or a disabled reload bails out.

## Touch

- `apps/server/src/tosu/live.ts` — epoch, both start/stop entry points, `refreshProbeAndMaybeSpawn`

## Tests

The tosu live tests should drive `refreshProbeAndMaybeSpawn` with a probe that resolves after `startTosuAdapter` has been called with `enabled: false`. Assert `spawnTosu` was not called and `warnings` stays the cleared list. A second case: probe resolves with no intervening restart, spawn still happens when `allowSpawn` is true and http is down.
