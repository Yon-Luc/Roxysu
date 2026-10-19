---
id: F-007
feature: desktop
kind: correctness
severity: medium
confidence: verified
status: fixed
---

# Desktop quit does not wait for child processes

## What

`before-quit` called `void shutdown()`. `shutdown` sent `SIGTERM` to the overlay host, realm-reader, and server, then returned. It did not call `event.preventDefault()`, and it did not wait until those processes exited.

## Why (corrected on verification)

`shutdown`'s body has no `await`, so the `SIGTERM`s *are* delivered before Electron exits, and children with default signal handling (the overlay host) die promptly. The real risk is children with cooperative handlers:

- realm-reader (`apps/realm-reader/src/index.ts`) only sets a flag on `SIGTERM`; the loop checks it between syncs, so a long extraction keeps it alive.
- server (`apps/server/src/index.node.ts`) awaits `app.stop(true)` before `process.exit`, which can be slow.

With no timeout or `SIGKILL` follow-up, these can outlive Electron and keep `ROXYSU_PORT`. The next launch's server then fails to bind and its exit takes the whole desktop app down (`server exited` → `app.exit`).

## Fix

`stopChild` now returns a promise (SIGTERM, `SIGKILL` after `CHILD_STOP_GRACE_MS`). `shutdown` is memoized and awaits all children. `before-quit` calls `preventDefault()`, awaits `shutdown()`, then `app.quit()` again.

## Not covered

On Windows dev runs (`shell: true`) or `npx tsx` fallback the signalled pid is a wrapper, so the real node child may still survive. Packaged installs spawn node directly and are unaffected.

## Evidence

- `apps/desktop/main.js`: `stopChild`, `shutdown`, `before-quit` handler.
