---
id: F-007
feature: desktop
kind: correctness
severity: high
confidence: verified
---

# Desktop quit does not wait for child processes

## What

`before-quit` calls `void shutdown()`. `shutdown` sends `SIGTERM` to the overlay host, realm-reader, and server, then returns. It does not call `event.preventDefault()`, and it does not wait until those processes exit.

## Why

Electron continues quit as soon as `before-quit` handlers return. `stopChild` is a single `child.kill("SIGTERM")` with no timeout and no `SIGKILL` follow-up. The children can outlive the shell and keep `ROXYSU_PORT` or the Wayland overlay.

## How to improve

In `before-quit`, call `preventDefault()`, await a shutdown that waits for `exit` (with a short `SIGKILL` deadline), then `app.exit()`.

## Potential gain

Closing the window leaves no server, realm-reader, or overlay host behind. The next launch does not collide with a leftover listener.

## Evidence

- `apps/desktop/main.js` `stopChild` (lines 539–546) and `shutdown` (lines 559–573).
- `app.on("before-quit", () => { void shutdown(); })` (lines 743–745).
