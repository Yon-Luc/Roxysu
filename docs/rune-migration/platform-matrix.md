# Rune prototype — platform matrix

**Prototype:** `apps/play-rune`  
**Rune pin:** `a57ffe07a05bdd1920908e6f97db91ceadea5bcc` (see `rune-pin.md`)  
**Recorded:** 2026-11-06  

Legend: `supported` · `limited` · `unsupported` · `not yet tested`

## Environments

| Capability | Headless | NixOS + KDE Wayland (session at smoke) | NixOS + Niri Wayland | X11 | Windows |
|---|---|---|---|---|---|
| Control window opens | supported (`--snap`) | supported (process stays up; dual-monitor host) | not yet tested | not yet tested | not yet tested |
| Transparent overlay | supported (straight-alpha PNG export) | limited — overlays created; visual chrome not photographed this session | not yet tested | not yet tested | not yet tested |
| Borderless / always-on-top | n/a (virtual display) | limited — `WindowOptions::overlay` applied; compositor behaviour not measured | not yet tested | not yet tested | not yet tested |
| Click-through on/off | n/a | not yet tested (manual pointer check) | not yet tested | not yet tested | not yet tested |
| Show / hide overlay | n/a | not yet tested (control buttons present) | not yet tested | not yet tested | not yet tested |
| Focus steal | n/a | not yet tested | not yet tested | not yet tested | not yet tested |
| Multi-monitor overlays | headless uses one virtual display | supported — `overlay-0` and `overlay-1` both reported ready | not yet tested | not yet tested | not yet tested |
| Fake telemetry updates | limited — LiveText path compiled; snap is single frame | supported — telemetry thread + `wake()` while process runs | not yet tested | not yet tested | not yet tested |
| Fractional scaling | not yet tested | not yet tested | not yet tested | not yet tested | not yet tested |
| Fullscreen game under overlay | not yet tested | not yet tested | not yet tested | not yet tested | not yet tested |
| Interactive edge overlay (`App::overlay`) | n/a | unsupported on Wayland per Rune docs (pointer not wired) — prototype uses `WindowOptions::overlay` instead | unsupported (same) | limited (override-redirect path) | limited |

## Session notes (2026-11-06)

- Host: NixOS, `WAYLAND_DISPLAY=wayland-1`, `XDG_CURRENT_DESKTOP=KDE`, NVIDIA GeForce RTX 5070 (Vulkan via wgpu).
- `niri` 26.04 is installed but **this smoke did not run inside a Niri session** (`NIRI_SOCKET` unset). Primary-target Niri checks remain open.
- Headless: `./target/debug/roxysu-play-rune --snap /tmp/.../control.png --window controls` produced a 960×720 RGBA PNG; GPU init ~400 ms.
- Interactive: control + two overlays logged `play-rune: overlay-N ready (window_number=None)` (`window_number` is macOS-oriented).

## Known framework limits (carry forward)

1. Wayland **interactive** layer-shell edge overlays are unavailable in Rune — do not use `App::overlay` for clickable HUDs on Niri.
2. Monitor list is a **startup snapshot** — hot-plug untested.
3. Unsupported click-through prints a platform error (prototype logs `click-through: …`).

## Next smoke on Niri

From a Niri session:

```bash
nix develop -c bun run play:rune
```

Then verify transparency over a fullscreen client, click-through toggle, focus, and hide/show. Update this matrix in the same change.
