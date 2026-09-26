# GPUIX PR spec: `<surface>` element

**Status:** Draft — Roxysu upstream contribution target  
**Author context:** Roxysu Play playfield rendering  
**GPUIX version:** `@gpuix/react@0.5.1` (baseline)

---

## Purpose

Add a generic React → GPUI bridge for displaying an **in-memory RGBA8 image** on screen.

`<surface>` must not know about osu!mania, sprites, skins, charts, or playfields. It is a primitive building block — the same role `<img>` plays for filesystem paths, but for pixel buffers.

### Problem `<surface>` solves

GPUI `<img>` (via GPUIX) loads images through `ImageSource::Resource(Path)`:

- Cache key = filesystem path
- Same path + overwritten bytes → stale texture
- New path each frame → unbounded atlas / RAM growth (Roxysu verified)

GPUI already supports `ImageSource::Render(Arc<RenderImage>)` for in-memory images, but GPUIX does not expose it to React.

### Guarantee (first PR)

> **No path-based image-cache entry is created per frame.**

Whether GPUI reuses the same GPU allocation in place when `RenderImage` bytes change is an **implementation detail** optimizable later. The contract is: pixel updates do not go through the path asset loader.

---

## Non-goals (first PR)

- SharedArrayBuffer / zero-copy mapped buffers
- Persistent GPU buffer handles exposed to JS
- HTML Canvas 2D compatibility
- `<surface>` paint callbacks or draw commands
- Domain-specific props (sprites, tiling, scroll regions)
- Promise of literal in-place GPU texture mutation

---

## Architecture

```
React JSX
    │  pixels: Uint8Array (RGBA8, row-major)
    │  width, height, objectFit
    ▼
@gpuix/react reconciler
    │  setCustomProp("pixels", …)  — see N-API section
    │  setCustomProp("width", …)
    │  setCustomProp("height", …)
    ▼
SurfaceFactory (Rust CustomElement)
    │  validate buffer
    │  copy bytes → SurfaceState
    │  build / update RenderImage
    ▼
gpui::img(ImageSource::Render(image))
    │  object_fit from prop
    ▼
GPUI paint → GPU texture (implementation-defined reuse)
```

Contrast with current `<img>`:

```
frame-1.png → Resource::Path → cached texture #1
frame-2.png → Resource::Path → cached texture #2
…
```

With `<surface>`:

```
surface element #42
    └── RenderImage (owned by element state)
          └── GPU backing (may be recreated on update)
```

---

## TypeScript / JSX API

### `SurfaceProps`

```typescript
import type { Props } from "@gpuix/react";

export type SurfaceObjectFit =
  | "fill"
  | "contain"
  | "cover"
  | "scaleDown"
  | "none";

export interface SurfaceProps extends Props {
  /** Pixel width of `pixels`. Must be > 0. */
  width: number;

  /** Pixel height of `pixels`. Must be > 0. */
  height: number;

  /**
   * RGBA8 pixels, row-major, top-left origin.
   * Required length: width * height * 4.
   */
  pixels: Uint8Array;

  /**
   * How the image fills its layout box (same semantics as `<img objectFit>`).
   * Default: `"fill"`.
   */
  objectFit?: SurfaceObjectFit;
}
```

### JSX intrinsic

```typescript
// packages/react/jsx-runtime.d.ts
interface IntrinsicElements {
  surface: SurfaceProps;
  // …existing…
}
```

```typescript
// packages/react/dist/types/host.d.ts
export type ElementType =
  | "div"
  | "text"
  | "img"
  | "surface"  // NEW
  | …;
```

### Usage example

```tsx
const buffer = new Uint8ClampedArray(width * height * 4);
// … fill RGBA …

<surface
  width={width}
  height={height}
  pixels={buffer}
  objectFit="fill"
  style={{ width, height }}
/>
```

### Prop update semantics

| Prop change | Expected behavior |
|-------------|-------------------|
| `pixels` (same w/h) | Element updates image content; **no new path-cache entry** |
| `width` / `height` | Revalidate buffer length; rebuild `RenderImage` if valid |
| `objectFit` | Relayout / repaint with new fit mode |
| `style` width/height | Normal GPUI layout (image scales within bounds) |

Do **not** require a React `key` change to refresh pixels. Stable element identity is the point.

---

## N-API / JS bridge

### Prop encoding

Follow existing custom elements (`<img>`, `<svg>`): React calls `setCustomProp(id, key, valueJson)`.

| Key | JSON type | Notes |
|-----|-----------|-------|
| `width` | `number` | u32 after cast |
| `height` | `number` | u32 after cast |
| `objectFit` | `string` | optional |
| `pixels` | **binary** | see below |

### `pixels` representation (v1)

**Use `Uint8Array` copied across the N-API boundary.**

Options considered:

| Approach | v1 | Later |
|----------|----|-------|
| `Uint8Array` copy → `Vec<u8>` | ✅ | — |
| Base64 in JSON | ❌ too slow | — |
| SharedArrayBuffer | ❌ | maybe |
| External buffer handle | ❌ | maybe |

Suggested N-API extraction (conceptual):

```rust
fn read_pixels_from_js(env: &Env, value: &JsUnknown) -> Result<Vec<u8>, SurfaceError> {
    let typed = value.coerce_to_typedarray()?;
    let buf = typed.into_raw();
    Ok(buf.to_vec())
}
```

If JSON fallback is required for the existing `setCustomProp` string path, accept base64 **only** as a dev fallback — production React path should pass binary via the same mechanism other elements use for large payloads (verify against gpuix `setCustomProp` implementation when implementing).

### Size note

480 × 680 × 4 ≈ **1.30 MB** per upload.

At 240 Hz → ~311 MB/s theoretical copy bandwidth. Acceptable for desktop v1; profile before optimizing.

---

## Rust: `Surface` element

### Module layout (suggested)

```
packages/native/src/custom_elements/
  mod.rs          — register SurfaceFactory
  surface.rs      — Surface element + state
  surface_error.rs
```

Register in `CustomElementRegistry::with_defaults()`:

```rust
registry.register("surface", SurfaceFactory);
```

### State

```rust
struct SurfaceState {
    width: u32,
    height: u32,
    pixels: Arc<Vec<u8>>,
    image: Option<Arc<RenderImage>>,
    object_fit: ObjectFit,
}
```

`Arc` allows cheap clone into paint closure if GPUI requires it.

### Validation

Reject invalid input **without panicking**:

```rust
enum SurfaceError {
    InvalidDimensions { width: u32, height: u32 },
    InvalidBufferLength { expected: usize, actual: usize },
    EmptyBuffer,
}
```

Rules:

```rust
fn validate(width: u32, height: u32, pixels: &[u8]) -> Result<(), SurfaceError> {
    if width == 0 || height == 0 {
        return Err(SurfaceError::InvalidDimensions { width, height });
    }
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|p| p.checked_mul(4))
        .ok_or(SurfaceError::InvalidDimensions { width, height })?;
    if pixels.len() != expected {
        return Err(SurfaceError::InvalidBufferLength {
            expected,
            actual: pixels.len(),
        });
    }
    Ok(())
}
```

On error:

- Log once (debug / warn)
- Paint nothing or last valid frame (pick one; document in PR)
- Do **not** crash the renderer

### `RenderImage` construction

Pseudocode — adjust to actual GPUI 0.x API names:

```rust
fn rebuild_image(state: &mut SurfaceState, cx: &App) -> Result<(), SurfaceError> {
    validate(state.width, state.height, &state.pixels)?;

    let size = size(state.width, state.height);
    let image = RenderImage::from_rgba8(state.width, state.height, state.pixels.clone());
    // or Image::from_bytes(Rgba, …) depending on GPUI version

    state.image = Some(Arc::new(image));
    Ok(())
}
```

Call `rebuild_image` when:

- `pixels` prop changes
- `width` / `height` change with matching buffer

Optional optimization (not required v1): skip rebuild if `Arc::ptr_eq` on identical buffer — unlikely from JS.

### CustomElement lifecycle

Implement `CustomElement` trait (mirror `<img>` factory pattern):

```rust
struct SurfaceElement {
    state: SurfaceState,
}

impl CustomElement for SurfaceElement {
    fn on_prop_changed(&mut self, key: &str, value: &JsValue, cx: &mut App) {
        match key {
            "width" => …,
            "height" => …,
            "objectFit" => …,
            "pixels" => {
                // copy + validate + rebuild_image
            }
            _ => {}
        }
    }

    fn render(&mut self, cx: &mut App) -> AnyElement {
        let Some(image) = &self.state.image else {
            return gpui::Empty.into_any_element();
        };

        gpui::img(ImageSource::Render(image.clone()))
            .object_fit(self.state.object_fit)
            .into_any_element()
    }
}
```

Exact method names follow gpuix `CustomElement` / `ImgFactory` conventions.

### Paint path

```rust
img(ImageSource::Render(image.clone()))
    .object_fit(object_fit)
```

**Not** `ImageSource::Resource`. **Not** writing temp files.

---

## React reconciler changes

1. Add `"surface"` to element type enum.
2. Map `pixels` prop to native binary prop (not JSON.stringify — will corrupt/limit).
3. Reserved props: `style`, `className`, event handlers — same as other elements.

No changes to Roxysu app required in GPUIX package beyond types export:

```typescript
export type { SurfaceProps, SurfaceObjectFit } from "./types/host";
```

---

## Test plan (GPUIX repo)

### 1. Native unit tests

- `validate()` accepts correct dimensions
- rejects `width=0`, length mismatch, overflow sizes
- `rebuild_image` produces non-empty `RenderImage` for 2×2 gradient

### 2. Integration test app (new example)

Minimal React app — **not** Roxysu:

```tsx
// examples/surface-demo/app.tsx
function SurfaceDemo() {
  const { width, height, pixels, frame } = useAnimatedGradient(256, 256);
  return (
    <surface
      width={width}
      height={height}
      pixels={pixels}
      objectFit="fill"
      style={{ width: 256, height: 256 }}
    />
  );
}
```

Animation: shift a horizontal bar each frame (same pattern as Roxysu texture Test C, but **no PNG files**).

**Pass criteria:**

- Bar moves smoothly for 60+ seconds
- No `failed to allocate` in logs
- Memory stable (no linear atlas growth)
- Invalid `pixels` length → no crash, visible fallback

### 3. Regression

- Existing `<img>` tests unchanged
- Unknown element types still warn + render Empty

---

## Roxysu integration (after merge)

No playfield logic changes. Swap output sink only:

```
PlayfieldRenderer
       ↓
CanvasPlayfieldBackend  →  Uint8ClampedArray RGBA
       ↓
<surface pixels={buffer} width={W} height={H} />
```

Remove from Roxysu (when wired):

- PNG ring buffer (`playfieldSurfacePaths.ts` generation paths)
- `PlayfieldCanvasLayer` setTimeout compositor loop
- Disk writes in hot path

Keep:

- `CanvasPlayfieldBackend` CPU compositor
- `PlayfieldDrawContext` abstraction
- `PlayfieldRenderer`

Future backend split:

```
PlayfieldDrawContext
    ├── RgbaSurfaceBackend   → <surface>        (intermediate)
    └── GpuiCanvasBackend    → gpui::canvas()   (long-term)
```

---

## Implementation checklist (GPUIX PR)

- [ ] `SurfaceProps` in `@gpuix/react` types + jsx intrinsics
- [ ] `SurfaceFactory` registered in native registry
- [ ] `pixels` binary prop through N-API
- [ ] Validation + error logging
- [ ] `ImageSource::Render` paint path
- [ ] `objectFit` prop (default `fill`)
- [ ] `examples/surface-demo` with animated gradient
- [ ] Native + integration tests
- [ ] CHANGELOG entry
- [ ] README: `<surface>` row in Supported Elements (move from planned → done)

---

## References

- GPUI `ImageSource`: `crates/gpui/src/elements/img.rs` (Zed)
- GPUI `canvas()`: `crates/gpui/src/elements/canvas.rs` (Zed)
- GPUIX `<img>` impl: `packages/native/src/custom_elements/img.rs`
- Roxysu PNG cache findings: `apps/play/src/playfield/texture-refresh-findings.md`
- Roxysu draw context plan: `apps/play/plan/06-playfield-renderer.md` §21–22

---

## Open questions (resolve during implementation)

1. **Exact `setCustomProp` binary path** — does gpuix already support TypedArray for any element, or does this PR extend the bridge?
2. **`RenderImage::from_*` API** — confirm signature against pinned GPUI revision in gpuix.
3. **Invalid prop behavior** — hold last frame vs clear to transparent (recommend: last valid frame).
4. **Alpha premultiplication** — document that input is straight RGBA8; match GPUI expectations.
