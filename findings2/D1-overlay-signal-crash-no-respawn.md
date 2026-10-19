---
cand: D1
reopens: F-038
feature: in-game-overlay
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# Overlay host never respawns after a signal crash

## Problem

The overlay poll sets `childExited` from `overlayChild.exitCode !== null` only. A child killed by a signal has `exitCode === null` and `signalCode` set. Node documents that. GTK and WebKit crashes are usually signals.

`decideOverlayApply` then takes the `hasChild && !childExited` branch. An unchanged URL returns `up-to-date` forever. The child object is never cleared, so the HUD stays dead until the app restarts.

A later URL change still spawns (`stopRunning: true` on that branch). Automatic liveness respawn does not. "Never" is too strong. "Not after a signal crash, until the URL changes" is the bug.

Realm-reader and `stopChild` already treat signal death as dead:

```js
realmChild.exitCode === null && realmChild.signalCode === null
child.exitCode !== null || child.signalCode !== null
```

## Potential solution

One predicate, used by the overlay poll and by the realm "still running" guard, so they cannot drift again.

```js
function childIsAlive(child) {
  return child != null && child.exitCode === null && child.signalCode === null;
}
```

Overlay poll:

```js
childExited: overlayChild !== null && !childIsAlive(overlayChild),
```

Realm spawn guard becomes `if (childIsAlive(realmChild)) return;`.

No policy change. `decideOverlayApply` already respawns when `childExited` is true and the gap has elapsed.

## Do not

- Do not treat `killed` as the signal. An exited child is not `killed`. The realm comment already says this.
- Do not clear `overlayChild` inside the policy. The caller already replaces it on `spawn`. The bug is the flag, not the policy table.

## Touch

- `apps/desktop/main.js` — the poll input at the `childExited` line, and the realm guard at the `exitCode === null && signalCode === null` check

## Tests

`overlayApplyPolicy` tests already cover `childExited: true`. Add a small test for the predicate: `{ exitCode: null, signalCode: "SIGSEGV" }` is not alive, `{ exitCode: null, signalCode: null }` is alive, `{ exitCode: 0, signalCode: null }` is not. Put the predicate in `overlayApplyPolicy.js` if that is the only tested module, and call it from `main.js`. Do not spawn a real child.
