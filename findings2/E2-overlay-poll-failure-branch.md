---
cand: E2
reopens: F-066
feature: in-game-overlay
kind: design-gap
severity: low
confidence: verified
status: proposed
---

# The "stop when polls fail" branch is unreachable

## Problem

`decideOverlayApply` stops the host on a failed poll only when `lastKnownEnabled === false` and a child exists. `lastKnownEnabled` becomes false only on a successful poll that returns `enabled: false`. That same decision is `stop` if a child exists, and `main.js` clears `overlayChild` before the next decision can run. There is no await between those two writes.

After a disable, `hasChild` is already false, so later failures stay `poll-failed` no-ops. The unit test that passes `lastKnownEnabled: false, hasChild: true` is not a state this shell produces.

The case the branch was written for: the user turns the overlay off, and the server dies before the next 4 s poll. The last successful read was still enabled, so the host keeps drawing against a dead server.

The same hole exists if the user left it on and the server dies. The host keeps drawing either way.

## Potential solution

Stop on the failure cap whenever a child is alive. Drop the `lastKnownEnabled === false` conjunct.

```js
const shouldStop =
  consecutiveFailures >= maxFailures && input.hasChild;
```

Keep the cap (`OVERLAY_MAX_POLL_FAILURES`). One failed poll must not kill the HUD.

When polls recover, the existing enabled path spawns again. No new respawn action. `lastKnownEnabled` can stay as a record of the last successful read. It just must not gate this stop.

Update the comment in `overlayApplyPolicy.js` and the comment in `main.js` that says the stop is only while the last known toggle was off. Both describe the unreachable rule.

## Do not

- Do not stop on the first failure. A 4 s blip should keep the HUD.
- Do not leave the unit test that feeds `lastKnownEnabled: false, hasChild: true` as the only coverage. That input is not what `main.js` produces. Replace it.

## Touch

- `apps/desktop/overlayApplyPolicy.js` — the `shouldStop` condition and its comment
- `apps/desktop/main.js` — the comment above the `decideOverlayApply` call
- the overlay policy test file

## Tests

- Failed polls at the cap, `lastKnownEnabled: true`, `hasChild: true` → `stop`, reason can stay `poll-failures-while-disabled` or become `poll-failures`. Rename the reason if the comment changes. Callers only branch on `action`.
- Same input below the cap → `noop` / `poll-failed`.
- After a `stop`, a later successful poll with `enabled: true` and `hasChild: false` → `spawn`. That transition should already exist. Assert it next to the new case so the respawn is not implied.
