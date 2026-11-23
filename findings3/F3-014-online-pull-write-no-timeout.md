---
id: F3-014
feature: online-score-pull
kind: correctness
severity: low
confidence: verified
status: proposed
---

# The online score pull's write child has no timeout, unlike score transfer's

## What

`runWriteCli` in the online-pull path waits for `npx tsx` with no timer. Score transfer
wraps its identical child in `armProcessTimeout(..., 45_000)`.

A wedged child keeps the Realm write lock and the ref-counted extraction pause held, so
every other Realm write answers 409 `in_flight` and Realm extraction stays paused until the
server restarts. Knowledge documents the 45 s kill for score transfer but no bound for the
pull.

## Why

`runWriteCli` has only `error` and `close` listeners. The commit's
`finally { lease.release() }` never runs while the promise is pending. Only the Bun CLI path
is affected; the desktop spawns the server under Node and writes in-process.

## How to improve

Reuse `armProcessTimeout` from the score-transfer path in `runWriteCli`, kill with SIGKILL,
and reject so `runCommit`'s `finally` releases the lease.

## Evidence

- `apps/server/src/online-scores/pull.ts:418-444` - no timer
- `apps/server/src/online-scores/pull.ts:485-492` - commit lease
- `apps/server/src/score-transfer/transfer.ts:46`, `:541-558`, `:580-599` - the bounded equivalent
- `apps/server/src/shared/realmWriteLock.ts:97-124` - pause and 409 behaviour
