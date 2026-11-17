# Rune prototype — acceptance criteria

Primary target: **NixOS + Niri + Wayland** (also exercise whatever compositor is active during smoke runs).

“Working” for the first Rune session means the isolated `apps/play-rune` prototype meets the checks below. Full Play feature parity is **not** required.

## Overlay behaviour

| Criterion | Required for go? | Notes |
|---|---|---|
| Transparent background where supported | Yes | Unsupported platforms may fall back to opaque (Rune docs). |
| Borderless window | Yes | |
| Always-on-top | Yes | |
| Click-through enable/disable at runtime | Yes | Via `WindowHandle::set_click_through`. |
| Show / hide / reposition overlay | Yes (show/hide); reposition best-effort | Wayland placement may be compositor-limited. |
| Overlay does not unexpectedly steal keyboard/mouse focus | Yes | |
| Multiple overlays independently | Nice-to-have | Prototype may use one overlay per display from Rune’s display snapshot. |
| Display change / monitor removal | Document only this session | Mark in platform matrix. |
| Fractional scaling | Document | |
| Fullscreen osu! behaviour | Document | |

### Known Rune / Wayland limits (must not be ignored)

- Rune **edge overlays** (`App::overlay` / `zwlr_layer_shell_v1`): on Wayland, **interactive overlays are unavailable** (pointer events not wired for that surface path). Prefer `WindowOptions::overlay(display)` for the Play prototype’s click-through toggle tests.
- Unsupported click-through prints a platform error rather than panicking (per Rune docs).
- Monitor enumeration is a **startup snapshot** in Rune — hot-plug needs later validation.

## Telemetry behaviour (fake feed in prototype)

| Criterion | Required |
|---|---|
| UI receives latest state without blocking the timer thread | Yes |
| Short bursts do not create an unbounded UI queue | Yes — latest-wins snapshot |
| Stale / disconnected represented clearly | Yes — status string on overlay |
| Updates coalesced without losing important discrete commands | Yes — commands are discrete; visuals coalesce |
| Rendering work not inside the telemetry timer callback | Yes — timer only writes state / wakes |

## Performance behaviour

Numerical targets are set **after** measuring GPUIX (`current-state.md`). For this session:

- No visible desktop stutter from the prototype alone while idle.
- No unbounded memory growth over a short (~5 min) run.
- Headless snap (if run) completes without crash.

Full GPUIX vs Rune comparison tables belong in `benchmark-results.md` (later phase).

## Prototype feature checklist

1. Rune window opens and closes cleanly.
2. Transparent, borderless overlay.
3. Always-on-top behaviour.
4. Runtime click-through toggling from a control window.
5. Control window can show/hide the overlay.
6. Fake telemetry feed updates a counter / status on the overlay.
7. One representative status widget.
8. Basic multi-monitor note (one overlay per display if Rune reports multiple).

## Automated smoke

`bun run play:rune:smoke` runs `--acceptance-smoke`: waits for overlays, asserts
telemetry ticks advance, toggles click-through and visibility via `WindowHandle`,
prints `ACCEPTANCE_SMOKE RESULT pass|fail`, then closes the control window.

This covers API readiness. Human pointer / focus / fullscreen checks remain
manual (see `platform-matrix.md`).
