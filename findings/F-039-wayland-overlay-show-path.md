---
id: F-039
feature: in-game-overlay
kind: correctness
severity: medium
confidence: likely
---

# Wayland overlay show path does not undo a hide

## What

Focus-follow hides the window with `gtk_widget_set_visible(..., FALSE)` and clears `g_mapped`. The next show calls `gtk_window_present` and toggles the layer shell from top to overlay. It does not call `gtk_widget_set_visible(..., TRUE)`. If the window is already considered shown, `apply_visibility` returns immediately because `g_last_applied == visible`, so a later focus event does not reassert the layer.

## Why

On GTK4 layer-shell, `present()` does not always map a widget that was set not visible. Compositors that drop a remapped overlay under fullscreen osu! need the layer reasserted. That reassert only runs inside `visible && !g_mapped`.

## How to improve

On show, set the widget visible before `present`, and reapply anchors and layer when focus returns even if the window was never unmapped.

## Potential gain

The HUD comes back above fullscreen osu! after alt-tab, including on niri and Hyprland.

## Evidence

- `apps/overlay/main.c` `apply_visibility` (lines 271–292): early return when `g_last_applied == visible`; hide uses `gtk_widget_set_visible(..., FALSE)`; show uses `gtk_window_present` and layer toggles only when `!g_mapped`.
