---
cand: D2
feature: desktop
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# Desktop child processes have no error listener

## Problem

`spawn` failures (ENOENT, EACCES, a wrong-glibc overlay binary) emit `'error'` and do not emit `'exit'`. They set `exitCode` to a negative errno. Nothing in `apps/desktop` listens for `'error'` on realm-reader, overlay, or the server. The only `'error'` listeners are HTTP requests and the auto-updater.

An `'error'` event with no listener throws. Electron does not quit on that. This app has no `uncaughtException` handler, so Electron shows a dialog and continues. The process does not die. The first writeup overstated that.

What actually breaks:

- Overlay poll sees `exitCode !== null`, so after the 15 s gap it spawns again and throws again. The dialog repeats.
- Realm respawn is scheduled only from `'exit'`. A spawn failure never schedules it. The negative `exitCode` would not block a later spawn, but nothing calls `spawnRealmReader`.
- Server has no respawn. Spawn failure also skips the `'exit'` → `shutdown()` path, so the splash waits until `waitForServer` times out, and the dialog has already fired.

`try/catch` around `spawn()` does not catch this. The failure is asynchronous.

## Potential solution

One helper, attached before any await, on every child `spawnNodeEntry` and `spawnOverlayHost` return.

```js
function watchChildError(child, label, onFailure) {
  child.on("error", (err) => {
    desktopLog(`${label} spawn failed: ${err.message}`);
    onFailure(err);
  });
}
```

- Overlay: log only. The poll already respawns off `exitCode !== null`. A second schedule would double-spawn. The listener's job is to swallow the event.
- Realm: log, then `scheduleRealmRespawn` with the same guards as the exit handler (`shuttingDown`, `child !== realmChild`). That is the path `'exit'` would have taken.
- Server: log, then the same `shutdown()` the exit handler calls. Do not invent a server respawn. A missing server binary should quit, not loop.

Attach the listener in the same function that assigns `realmChild` / `overlayChild` / `serverChild`, so the identity guard sees the current child.

## Do not

- Do not add an `uncaughtException` handler that exits. That turns today's dialog into a quit, and it hides the missing listener instead of fixing the three policies.
- Do not treat `'error'` as a crash of a live child. A live crash emits `'exit'` with a signal (D1). `'error'` is spawn failure.

## Touch

- `apps/desktop/main.js` — `spawnRealmReader`, `spawnOverlayHost`, the server spawn next to the existing `'exit'` handlers

## Tests

Extract nothing if the handlers are three lines. If a test is added, it should be a fake `EventEmitter`: emit `'error'`, assert the realm callback schedules respawn and the overlay callback does not. Do not spawn a binary.
