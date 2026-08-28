# GPUIX constraints for `@/components/ui`

Authoritative source: [gpuix — Let an agent drive the app](https://github.com/remorses/gpuix#let-an-agent-drive-the-app) and the full README. Components in this folder must respect these limits.

## Agent / automation

| Topic | Rule |
| --- | --- |
| Background runs | Set `focus: process.env.GPUIX_BACKGROUND !== '1'` in `render()` so agents do not steal focus. Use `gpuixRenderOptions()` from `./lib/render-options`. |
| Linux focus | `focus: false` is **ignored on Linux** — the window still opens focused. |
| `launch()` typing | `fill()` / `press()` throw `keystrokes are not live yet` on a child process. Prefer `createTestRoot()` when tests need keyboard input. |
| Locators | Put `testId` on interactive nodes (`Button`, `Input`, overlay surfaces). `<virtual-list>` cannot take `testId` — wrap it. |
| Screenshots | `screenshot()` reads the GPU surface; focus is not required. |

## Text & color

| Topic | Rule |
| --- | --- |
| Default text color | GPUI paints **black** when `color` is omitted. Every `<text>` needs an explicit `color`, or a parent `<div>` with `color` (GPUI propagates via `Styled`). |
| `white-space: pre` | **Not supported.** Split on `\n` and render one `<text>` per line, or use `MultilineText`. |
| Wrapping | Only `normal` (wrap) and `nowrap` (single line). |

## Scrolling (critical)

| Topic | Rule |
| --- | --- |
| Enable scrolling | Use `overflow: "scroll"`. `"auto"` does **not** create a scroll container. |
| Nested scroll | **One vertical scroller per subtree.** Never nest `overflow: "scroll"`, `<virtual-list>`, or `<diff>` inside another vertical scroller — wheel events hit both hitboxes. |
| Long inner content | Use `Expandable` (preview + “Show more”) instead of a nested scroll viewport. |
| Horizontal exception | `overflowX: "scroll"` on a wide child is OK inside a vertical parent. Set `flexShrink: 0` or a definite width on the wide child. |
| Frozen header + body | Native scroll cannot drive a sticky header (one-frame tear). Own `scrollX`/`scrollY` in React and translate panes, or keep header outside the scroller. |
| Flex children | Scroll containers in a column need `minHeight: 0` (and usually `flexGrow: 1`, `flexBasis: 0`). `ScrollArea` sets these by default. |
| Textarea / virtual-list rows | Native `<textarea>` and virtual-list row children must **not** scroll. |

## Pointer & overlays

| Topic | Rule |
| --- | --- |
| Wheel hit-testing | Wheel reaches **any** scroller behind the pointer, not only ancestors. Full-screen overlays need `pointerEvents: "auto"` on the scrim. |
| `pointerEvents: "none"` | Element inserts **no** hitbox; does not inherit to children. |
| `hover` / `active` | One level deep only — no nested pseudo states. Not allowed on `<virtual-list>` (wrap in `<div>`). |
| `anchored` clicks | Automation `click()` targets the overlay bounds, not the trigger. |

## Select & composition

| Topic | Rule |
| --- | --- |
| `SelectItem` identity | Must remain the **native** `@gpuix/react` reference. Style via the `style` prop + `selectItemStyle()` — a wrapper breaks option collection. |
| `asChild` / `renderSlot` | Merge styles with `mergeStyles()` so `hover`/`active` are not clobbered. |

## Rendering & tests

| Topic | Rule |
| --- | --- |
| `flushSync` | Flushes React only, not GPUI layout/paint. Call `renderer.flush()` or wait a frame for pixels. |
| SVG icons | `style.color` is required for `<svg>`. `currentColor` in the file is not the same as `style.color`. |
| Hot reload | Native `.node` cannot unload; `bun run dev` rebuilds and restarts. |

## Component checklist (new PRs)

1. Explicit `color` on all `<text>` (or colored parent `<div>`).
2. At most one vertical `overflow: "scroll"` in a layout branch.
3. `testId` on primary interactive targets.
4. No DOM APIs (`document`, `window`, `className`, CSS files).
5. Overlay dismiss uses `onMouseDownOutside` + `queueMicrotask` guard (see `Popover` / `Dialog`).
