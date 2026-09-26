# GPUI / GPUIX `<img>` texture cache — findings

> **2026-08:** PNG ring-buffer compositor abandoned (RAM, atlas growth, jank).  
> **Target:** GPUIX `<surface>` — see `apps/play/docs/gpuix-surface-pr-spec.md`.  
> **Interim:** `PlayView` uses div/CSS note fallbacks (no per-note `<img>`).

Source: GPUI `crates/gpui/src/elements/img.rs`, GPUIX changelog, Roxysu experiments (2026-08).

## Pipeline

```
React <img src={path} key="playfield-surface" />
        ↓
GPUIX reconciler → setCustomProp("src", path)
        ↓
gpuix ImgElement → gpui::img(PathBuf)
        ↓
ImageSource::Resource(Resource::Path)
        ↓
ImageAssetLoader / AssetLogger (global image cache)
        ↓
fs::read(path) → decode → RenderImage → atlas slot
```

## Cache key questions

| Question | Answer (from source + experiments) |
|----------|-------------------------------------|
| Is filesystem path the cache key? | **Yes** — `Resource::Path` is the asset `Source`; GPUI asset cache keys on `Resource`. |
| Does changing `src` cause a new texture lookup? | **Yes, if path string changes** — new `Resource` → new cache entry / load. |
| Does GPUI check file mtime? | **No evidence** — `ImageAssetLoader::load` does `fs::read` once per cache miss; no stat/mtime. |
| Overwrite same path, same `src`? | **Stale texture** — cache hit returns old decoded image (Test A / bar frozen). |
| A↔B path swap, stable `<img>`? | **Loads both paths once** — colors flip; bar frozen at first-load content per path (Test B partial). |
| Texture tied to element or path? | **Path (Resource)** in global asset cache; element holds `ImageSource`. |
| Remount with new `key`? | New element; **leaks atlas slots** if old textures not evicted. |
| Raw texture upload without new path? | **Not exposed** in GPUIX `<img>` — would need custom element or `ImageSource::Render`. |

## Experiment results (Roxysu)

| Test | Setup | Observed |
|------|-------|----------|
| **A** | `frame.png` overwrite, same `src` | Bar frozen (expected) |
| **B** | `frame-a.png` ↔ `frame-b.png` | Colors flip; bar frozen |
| **C** | Ring `frame-00` … `frame-63` | **Pass** — bar moves at ~60fps, stable `<img>`, no atlas errors in dev |

### Interpretation of B

Path change **invalidates** which cached texture is bound (A vs B), but each path's texture is **immutable after first load**. Updating PNG bytes on disk does not refresh an existing cache entry.

### Interpretation of C (verified)

Each **new path** in the ring triggers a fresh `fs::read` + decode. After the ring wraps (~64 frames), paths are reused — by then GPUI has moved on and the slot can be rewritten before `src` points at it again (same discipline as the test: write the slot you are about to display, never the slot currently on screen).

**Test C satisfies the compositor success criteria** in dev: 1 `<img>`, 0 remounts, `src` changes every frame, visual updates, no `failed to allocate` during the run.

**Still validate before shipping:** run Test C for several minutes on a dense map session and confirm atlas does not grow unbounded (watch for late `failed to allocate`).

### Implication for compositor

- **Not viable:** single PNG path + overwrite each frame.
- **Not viable:** 2-path ping-pong with updated content (only 2 frozen frames).
- **Viable (short-term):** ring-buffer compositor — verified in isolation (Test C) but **abandoned for production** (RAM / atlas growth / jank when wired to PlayView).
- **Target:** GPUIX `<surface>` + `ImageSource::Render` — see `apps/play/docs/gpuix-surface-pr-spec.md`.
- **Long-term:** GPUI `canvas()` native paint backend.

## Success criteria (compositor backend)

```
1 <img> + 0 remounts + src changes every frame + ~60 FPS
+ no atlas growth + visual position changes every frame
```

If Test C passes without atlas errors → prototype `CompositedImageBackend` with ring buffer. **Status: Test C passed in dev (2026-08).**

If Test C fails or atlas grows → stop PNG compositing; investigate native surface.

**Status:** Test C passed in isolation; production PNG compositor abandoned. PlayView uses div fallbacks until `<surface>` lands.

## Recommended next implementation

See **`apps/play/docs/gpuix-surface-pr-spec.md`**.

```
PlayfieldRenderer → PlayfieldSnapshot
        ↓
CanvasPlayfieldBackend (CPU RGBA — keep)
        ↓
<surface pixels={buffer} width={W} height={H} />
```

~~ring slot[frame % 64] — write PNG, then set src~~ (deprecated)

## References

- GPUI img: https://github.com/zed-industries/zed/blob/main/crates/gpui/src/elements/img.rs
- GPUIX img element: changelog 0.5.x — `gpui::img(PathBuf)` + `src` / `objectFit` props
- GPUIX README: `<img>` requires filesystem path, not URL (except SVG data URLs)
