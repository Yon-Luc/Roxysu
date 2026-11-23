---
id: F3-034
feature: in-game-overlay
kind: logic-gap
severity: medium
confidence: verified
status: proposed
---

# The overlay WebView crash-loop retries every second, forever, with no backoff

## What

A web-process death recreates the `WebView` after 1 s. Because the reload state machine is
constructed per WebView, the 5-failure 15 s backoff can never be reached across recreates.

A page or WebKit combination that kills the renderer on load loops recreate, load, crash at
about 1/s indefinitely. The surface stays unmapped because navigation unmaps it, so the user
sees a dead HUD while the host burns a core. The desktop's crash-loop park never engages
because the process never exits.

## Why

`wire_reload` allocates `Rc::new(RefCell::new(ReloadMachine::new()))` inside itself, and
`attach_webview` -> `recreate()` builds a fresh WebView and a fresh machine.
`consecutive_load_failures` therefore always starts at 0 after
`ReloadTrigger::WebProcessTerminated`, whose delay is fixed at 1 s.

## How to improve

Hoist one `ReloadMachine` per host, storing it in `PageGate`, which already outlives WebViews,
and route both `LoadFailed` and `WebProcessTerminated` through it. Count reconnects in the same
streak.

Optionally exit with code 75 after N recreates inside a window, so the desktop liveness and
park policy takes over.

## Evidence

- `apps/overlay-rs/src/overlay.rs:512-520` - recreate builds a new WebView
- `apps/overlay-rs/src/overlay.rs:560-561` - machine allocated per WebView
- `apps/overlay-rs/src/overlay.rs:606-627`, `:694-700` - trigger handling
- `apps/overlay-rs/src/reload.rs:8-11`, `:48-61` - fixed 1 s delay, failure streak
