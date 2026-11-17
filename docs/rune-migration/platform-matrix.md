# Rune prototype — platform matrix

**Prototype:** `apps/play-rune`  
**Rune pin:** `a57ffe07a05bdd1920908e6f97db91ceadea5bcc` (see `rune-pin.md`)  
**Recorded:** 2026-11-06  

Legend: `supported` · `limited` · `unsupported` · `not yet tested`

Automated API checks use `bun run play:rune:smoke` (`--acceptance-smoke`). These verify
Rune handle APIs and telemetry coalescing; they do **not** replace a human pointer
test for true click-through against another client.

## Environments

| Capability | Headless | NixOS + KDE Wayland | NixOS + Niri Wayland (nested under KDE) | X11 | Windows |
|---|---|---|---|---|---|
| Control window opens | supported (`--snap`) | supported | supported (briefly; see notes) | not yet tested | not yet tested |
| Transparent overlay | supported (straight-alpha PNG) | limited — overlays created; visual chrome not photographed | limited — overlay created on Niri Wayland socket; nested NVIDIA/winit dmabuf noisy | not yet tested | not yet tested |
| Borderless / always-on-top | n/a | limited — `WindowOptions::overlay` applied | limited — same API path under Niri socket | not yet tested | not yet tested |
| Click-through on/off (API) | n/a | supported (`--acceptance-smoke`) | supported until compositor drop | not yet tested | not yet tested |
| Click-through (human pointer) | n/a | not yet tested | not yet tested | not yet tested | not yet tested |
| Show / hide overlay (API) | n/a | supported | limited — hide succeeds; show-after-hide hit Wayland disconnect in nested run | not yet tested | not yet tested |
| Focus steal | n/a | not yet tested | not yet tested | not yet tested | not yet tested |
| Multi-monitor overlays | one virtual display | supported (2 overlays) | limited — nested config exposes 1 winit output | not yet tested | not yet tested |
| Fake telemetry updates | limited (single-frame snap) | supported | supported | not yet tested | not yet tested |
| Fractional scaling | not yet tested | not yet tested | not yet tested | not yet tested | not yet tested |
| Fullscreen game under overlay | not yet tested | not yet tested | not yet tested | not yet tested | not yet tested |
| Interactive edge overlay (`App::overlay`) | n/a | unsupported on Wayland (Rune docs) | unsupported (same) | limited | limited |
| Full login Niri session (non-nested) | n/a | n/a | not yet tested | n/a | n/a |

## Session notes (2026-11-06)

### Headless

- `./target/debug/roxysu-play-rune --snap … --window controls` → 960×720 RGBA PNG; GPU NVIDIA RTX 5070 / Vulkan.

### KDE Wayland (active session)

- `WAYLAND_DISPLAY=wayland-1`, `XDG_CURRENT_DESKTOP=KDE`.
- `--acceptance-smoke` **RESULT pass**: overlays≥1, telemetry advances, click-through false/true, hide/show.
- Dual-monitor host: `overlay-0` and `overlay-1` both ready (smoke counted ≥1 early; second overlay still created).

### Nested Niri (under KDE)

- Command: `niri -c /tmp/…/config.kdl -- …/roxysu-play-rune --acceptance-smoke`
- Socket: `wayland-2` / `NIRI_SOCKET=…niri.wayland-2.…sock`
- Output: single `Smithay Winit` 1080×840; NVIDIA nested path logs `dmabuf import failed to mmap` and missing `EGL_EXT_device_drm`.
- Smoke got: overlays=1, telemetry pass, click-through pass, hide pass; then `Io error: Connection reset by peer` and Rune panic on exit before final show assert / clean RESULT line.
- **Interpretation:** Nesting is enough to prove the binary talks to a Niri Wayland server, but not a substitute for a real Niri login. Wayland hide may destroy the surface (Rune docs); recreate/show under nested NVIDIA is fragile.

## Known framework limits (carry forward)

1. Wayland **interactive** layer-shell edge overlays are unavailable in Rune — use `WindowOptions::overlay`, not `App::overlay`, for clickable HUDs.
2. Monitor list is a **startup snapshot** — hot-plug untested.
3. Unsupported click-through prints a platform error (prototype stores it for smoke).
4. On Wayland, hide/close semantics differ from X11/macOS (surface destroy) — validate show-after-hide on a real Niri login.

## Next smoke (full Niri login)

```bash
# Inside a Niri session:
nix develop -c bun run play:rune:smoke
nix develop -c bun run play:rune   # then manually verify pointer click-through over a fullscreen client
```

Update this matrix when those land.
