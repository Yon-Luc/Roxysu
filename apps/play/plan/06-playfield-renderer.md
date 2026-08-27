# Roxysu Playfield Renderer — Implementation Plan

## Goal

Extract the VSRG playfield from `apps/play/src/app.tsx` into a standalone renderer architecture.

The renderer should:

- Be independent from React as much as possible.
- Avoid per-note React state.
- Avoid per-frame object allocation.
- Use typed arrays for chart/runtime data.
- Cull notes before rendering.
- Keep timing and note-position calculations outside the UI.
- Allow GPUIX to be replaced or upgraded without rewriting the VSRG logic.
- Provide a clean path toward a future custom native/GPU renderer.
- Remain easy to benchmark independently from the rest of the application.

---

# 1. Target Architecture

Create:

```text
apps/play/src/
├── app.tsx
│
└── playfield/
    ├── PlayfieldRenderer.ts
    ├── PlayfieldTypes.ts
    ├── PlayfieldChart.ts
    ├── PlayfieldTiming.ts
    ├── PlayfieldVisibility.ts
    ├── PlayfieldGeometry.ts
    ├── PlayfieldEffects.ts
    ├── PlayfieldSkin.ts
    ├── PlayfieldDrawContext.ts
    │
    └── backends/
        ├── GpuixDrawContext.ts
        └── BenchmarkDrawContext.ts
```

The dependency direction should be:

```text
app.tsx
   │
   ▼
PlayfieldRenderer
   │
   ├── PlayfieldChart
   ├── PlayfieldTiming
   ├── PlayfieldVisibility
   ├── PlayfieldGeometry
   ├── PlayfieldEffects
   └── PlayfieldDrawContext
          │
          ├── GpuixDrawContext
          └── BenchmarkDrawContext
```

The playfield renderer must NOT depend on `app.tsx`.

---

# 2. Define the Public Renderer API

Create `PlayfieldRenderer.ts`.

Target API:

```ts
export class PlayfieldRenderer {
  constructor(
    options: PlayfieldRendererOptions,
  );

  loadChart(
    chart: PlayfieldChart,
  ): void;

  setSongTime(
    timeMs: number,
  ): void;

  setPlaying(
    playing: boolean,
  ): void;

  setScrollSpeed(
    speed: number,
  ): void;

  resize(
    width: number,
    height: number,
  ): void;

  render(): void;

  destroy(): void;
}
```

The React layer should only need to configure the renderer.

It should not manipulate individual notes.

---

# 3. Define Core Types

Create:

```text
PlayfieldTypes.ts
```

Define:

```ts
export interface PlayfieldRendererOptions {
  lanes: number;
  width: number;
  height: number;
  receptorY?: number;
  scrollSpeed?: number;
}

export interface PlayfieldChart {
  noteCount: number;

  startTime: Float64Array;
  endTime: Float64Array;

  lane: Uint8Array;
  type: Uint8Array;
}
```

Define note types:

```ts
export const enum NoteType {
  Tap = 0,
  Hold = 1,
}
```

Keep these structures renderer-oriented.

Do not pass full osu! beatmap objects into the renderer.

---

# 4. Build the Chart Representation

Create:

```text
PlayfieldChart.ts
```

Responsibilities:

- Convert parsed beatmap objects into renderer data.
- Sort notes by start time.
- Allocate typed arrays.
- Store only information required during rendering.
- Avoid creating temporary objects during rendering.

Example:

```ts
export function createPlayfieldChart(
  notes: SourceNote[],
): PlayfieldChart {
  // preprocess once
}
```

The conversion/preprocessing phase is allowed to allocate.

The render loop is not.

---

# 5. Implement Timing

Create:

```text
PlayfieldTiming.ts
```

Responsibilities:

- Store current song time.
- Convert note timestamps into screen positions.
- Handle scroll speed.
- Eventually support osu!mania timing/scroll behavior.

Initial API:

```ts
export class PlayfieldTiming {
  setSongTime(
    timeMs: number,
  ): void;

  getSongTime(): number;

  getNoteY(
    noteTime: number,
  ): number;
}
```

Initial formula can use constant scroll speed.

Do not over-engineer osu! timing in the first implementation.

Leave room for:

```text
song time
    ↓
timing points
    ↓
scroll velocity
    ↓
screen position
```

---

# 6. Implement Visibility Culling

Create:

```text
PlayfieldVisibility.ts
```

The renderer should never scan/render the entire chart when only a small portion is visible.

Because notes are sorted by time, use binary search.

Implement:

```ts
export interface VisibleRange {
  start: number;
  end: number;
}

export function findVisibleRange(
  chart: PlayfieldChart,
  songTime: number,
  beforeMs: number,
  afterMs: number,
): VisibleRange;
```

Use a `lowerBound()` implementation.

Target:

```text
100,000 notes
      ↓
binary search
      ↓
~100 visible notes
```

instead of:

```text
100,000 notes scanned every frame
```

---

# 7. Implement Geometry

Create:

```text
PlayfieldGeometry.ts
```

Responsibilities:

- Lane width.
- Lane X position.
- Receptor position.
- Note rectangles.
- Hold-note rectangles.
- Playfield dimensions.

Example:

```ts
export class PlayfieldGeometry {
  getLaneX(
    lane: number,
  ): number;

  getLaneWidth(): number;

  getReceptorY(): number;
}
```

Keep geometry calculations deterministic.

Avoid allocating objects in the hot path.

Prefer:

```ts
getNoteX(lane)
getNoteY(time)
getNoteWidth()
```

over returning:

```ts
{
  x,
  y,
  width,
  height
}
```

for every note.

---

# 8. Create the Draw Context Abstraction

Create:

```text
PlayfieldDrawContext.ts
```

This is the most important architectural boundary.

Define:

```ts
export interface PlayfieldDrawContext {
  beginFrame(): void;

  endFrame(): void;

  drawLane(
    lane: number,
    x: number,
    width: number,
  ): void;

  drawNote(
    lane: number,
    x: number,
    y: number,
    width: number,
    height: number,
    style: NoteStyle,
  ): void;

  drawHold(
    lane: number,
    x: number,
    y: number,
    width: number,
    height: number,
    style: NoteStyle,
  ): void;

  drawReceptor(
    lane: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
}
```

The renderer must only depend on this interface.

It must not directly know about GPUIX internals.

---

# 9. Implement the GPUIX Backend

Create:

```text
backends/GpuixDrawContext.ts
```

This backend translates:

```ts
drawNote(...)
```

into the currently supported GPUIX rendering primitives.

Initially this may still use GPUIX retained elements.

The goal is to isolate that limitation to this file.

Do NOT let GPUIX-specific concepts leak into:

```text
PlayfieldRenderer
PlayfieldTiming
PlayfieldChart
PlayfieldVisibility
PlayfieldGeometry
```

---

# 10. Implement a Benchmark Backend

Create:

```text
backends/BenchmarkDrawContext.ts
```

It should not actually render.

Instead track:

```text
frames
notes
holds
lanes
drawCalls
```

Example:

```ts
class BenchmarkDrawContext
  implements PlayfieldDrawContext {

  drawCalls = 0;
  notes = 0;

  beginFrame() {
    this.drawCalls = 0;
    this.notes = 0;
  }

  drawNote() {
    this.drawCalls++;
    this.notes++;
  }

  drawHold() {
    this.drawCalls++;
    this.notes++;
  }

  // ...
}
```

This allows testing:

```text
chart processing
timing
visibility
geometry
```

without GPU rendering.

---

# 11. Implement the Renderer Hot Path

`PlayfieldRenderer.render()` should conceptually become:

```ts
render() {
  const chart = this.chart;

  if (!chart) {
    return;
  }

  this.draw.beginFrame();

  this.renderLanes();

  const range =
    this.visibility.getVisibleRange(
      chart,
      this.time.getSongTime(),
    );

  for (
    let i = range.start;
    i < range.end;
    i++
  ) {
    const lane =
      chart.lane[i];

    const start =
      chart.startTime[i];

    const end =
      chart.endTime[i];

    const y =
      this.timing.getNoteY(
        start,
      );

    if (
      chart.type[i] ===
      NoteType.Hold
    ) {
      this.renderHold(
        i,
        lane,
        start,
        end,
      );
    } else {
      this.renderTap(
        i,
        lane,
        y,
      );
    }
  }

  this.renderReceptors();

  this.draw.endFrame();
}
```

This is the core of the system.

---

# 12. Strict Hot-Path Rules

Inside `render()` and functions called by it:

## Do

- Typed arrays.
- Numeric calculations.
- `for` loops.
- Cached values.
- Binary search.
- Reusable buffers.
- Direct renderer calls.

## Don't

- `Array.map()`.
- `Array.filter()`.
- `Array.sort()`.
- Creating note objects.
- Creating geometry objects.
- Creating style objects.
- React state updates.
- React hooks.
- JSON serialization.
- Logging every frame.
- DOM APIs.
- `requestAnimationFrame`.

The renderer should be safe to call thousands of times without generating significant garbage.

---

# 13. Move the Animation Loop Out of React

The renderer should eventually expose:

```ts
start(): void;
stop(): void;
```

or be driven externally by the application's timing loop.

Prefer a design where the renderer receives authoritative song time:

```ts
renderer.setSongTime(
  audioTimeMs,
);

renderer.render();
```

rather than:

```ts
renderer += deltaTime;
```

The audio clock should eventually be authoritative for gameplay.

This avoids drift.

---

# 14. Keep React as a Controller

`app.tsx` should eventually look roughly like:

```tsx
function ManiaPlayfield(props) {
  const rendererRef =
    useRef<PlayfieldRenderer | null>(
      null,
    );

  useEffect(() => {
    const renderer =
      new PlayfieldRenderer({
        lanes: 7,
        width: 700,
        height: 680,
      });

    rendererRef.current =
      renderer;

    return () => {
      renderer.destroy();
      rendererRef.current =
        null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current
      ?.setPlaying(props.playing);
  }, [props.playing]);

  useEffect(() => {
    rendererRef.current
      ?.setScrollSpeed(
        props.scrollSpeed,
      );
  }, [props.scrollSpeed]);

  return <PlayfieldHost />;
}
```

React controls:

- play/pause
- selected map
- settings
- skin
- scroll speed
- window size

The renderer controls:

- note positions
- visibility
- geometry
- draw calls
- effects
- frame rendering

---

# 15. Remove the Current Per-Note React Rendering

After the standalone renderer is working, remove:

```tsx
visibleIndexes.map(...)
```

from `app.tsx`.

Remove per-note JSX generation.

Remove the React `revision` mechanism.

Remove frame-by-frame React updates.

React should no longer reconcile every moving note.

---

# 16. Add Effects as a Separate System

Create:

```text
PlayfieldEffects.ts
```

Eventually support:

- hit explosions
- lane flashes
- judgment effects
- hold trails
- miss effects
- combo effects
- particles

Use fixed-size/reusable buffers.

For example:

```ts
interface EffectPool {
  active: Uint8Array;
  startTime: Float64Array;
  lane: Uint8Array;
  type: Uint8Array;
}
```

Avoid creating:

```ts
new Particle()
```

for every hit.

---

# 17. Add Skin Support

Create:

```text
PlayfieldSkin.ts
```

It should describe rendering configuration:

```ts
interface PlayfieldSkin {
  laneColors: ...;
  noteWidth: number;
  noteHeight: number;
  receptorHeight: number;
  holdWidth: number;
  effects: ...;
}
```

The skin should be data.

The renderer should interpret it.

Do not hardcode Roxysu's current benchmark colors into the renderer.

---

# 18. Add Tests Before GPU-Specific Optimization

Create:

```text
PlayfieldRenderer.test.ts
```

Test:

### Timing

```text
note at song time
note before song time
note after song time
```

### Visibility

```text
empty chart
one visible note
notes before window
notes after window
100k note chart
```

### Lanes

```text
4K
5K
6K
7K
8K
9K
```

### Holds

```text
zero duration
short hold
long hold
off-screen hold
```

### Edge cases

```text
negative time
very large timestamp
empty chart
one note
100k notes
```

---

# 19. Benchmark the Renderer Separately

Create benchmark scenarios:

```text
1K notes
5K notes
10K notes
25K notes
50K notes
100K notes
```

And:

```text
4K
5K
6K
7K
8K
```

Measure:

```text
chart preprocessing
visibility calculation
timing calculation
geometry
draw calls
total render CPU time
```

Then separately measure GPUIX rendering time.

The goal is to distinguish:

```text
Roxysu renderer cost
        vs
GPUIX cost
        vs
GPU cost
```

---

# 20. Establish Performance Targets

Initial targets:

### Renderer logic

For a typical visible range:

```text
< 0.25 ms
```

Target for heavy scenes:

```text
< 1 ms
```

### Allocations

Normal frame:

```text
0 allocations
```

or as close to zero as the runtime permits.

### Visibility

Must be approximately:

```text
O(log N + V)
```

where:

```text
N = total notes
V = visible notes
```

rather than:

```text
O(N)
```

per frame.

---

# 21. Future Custom Native Renderer

Do NOT implement a custom native renderer immediately.

First make this architecture work:

```text
PlayfieldRenderer
       │
       ▼
PlayfieldDrawContext
       │
       ▼
GpuixDrawContext
```

Once the logic is stable, a future native backend can replace it:

```text
PlayfieldRenderer
       │
       ▼
PlayfieldDrawContext
       │
       ├── GpuixDrawContext
       │
       └── NativeGpuDrawContext
```

The VSRG logic does not change.

---

# 22. Long-Term GPU Architecture

The desired final architecture is:

```text
                         React
                           │
                    configuration
                           │
                           ▼
                  PlayfieldRenderer
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
       Timing / Chart              Visibility
              │                         │
              └────────────┬────────────┘
                           │
                           ▼
                  PlayfieldDrawContext
                           │
                           ▼
                   Native Playfield
                           │
                    ┌──────┴──────┐
                    ▼             ▼
                 buffers       shaders
                    │             │
                    └──────┬──────┘
                           ▼
                          GPU
```

The ideal end state is one native/custom playfield element rather than thousands of GPUIX React elements.

---

# 23. Implementation Order

Implement in this exact order:

## Phase 1 — Extraction

- [ ] Create `playfield/`.
- [ ] Create `PlayfieldTypes.ts`.
- [ ] Move chart representation out of `app.tsx`.
- [ ] Create `PlayfieldRenderer.ts`.
- [ ] Keep existing visual behavior.

## Phase 2 — Data model

- [ ] Introduce typed-array chart.
- [ ] Convert beatmap data once.
- [ ] Sort notes once.
- [ ] Remove per-frame object creation.

## Phase 3 — Timing

- [ ] Create `PlayfieldTiming.ts`.
- [ ] Move note Y calculation there.
- [ ] Make song time authoritative.
- [ ] Add timing tests.

## Phase 4 — Visibility

- [ ] Create `PlayfieldVisibility.ts`.
- [ ] Implement `lowerBound`.
- [ ] Implement visible-range lookup.
- [ ] Add large-chart tests.

## Phase 5 — Geometry

- [ ] Create `PlayfieldGeometry.ts`.
- [ ] Move lane calculations.
- [ ] Move receptor calculations.
- [ ] Move note geometry.

## Phase 6 — Rendering abstraction

- [ ] Create `PlayfieldDrawContext.ts`.
- [ ] Implement GPUIX backend.
- [ ] Remove GPUIX details from renderer.

## Phase 7 — React integration

- [ ] Make React instantiate the renderer.
- [ ] Remove per-note JSX.
- [ ] Remove frame-level React state.
- [ ] Keep React as configuration/controller only.

## Phase 8 — Effects

- [ ] Add effect pools.
- [ ] Add hit effects.
- [ ] Add lane flashes.
- [ ] Add hold effects.

## Phase 9 — Benchmarking

- [ ] Add benchmark backend.
- [ ] Benchmark 1K → 100K notes.
- [ ] Benchmark 4K → 9K.
- [ ] Measure CPU/render/draw-call costs.
- [ ] Record regressions.

## Phase 10 — Native renderer investigation

- [ ] Investigate GPUIX custom/native element APIs.
- [ ] Prototype native playfield surface.
- [ ] Move draw operations from GPUIX elements to native rendering.
- [ ] Keep `PlayfieldRenderer` unchanged.

---

# 24. Definition of Done

The refactor is complete when:

- [ ] `app.tsx` contains no individual note rendering logic.
- [ ] `app.tsx` contains no frame animation logic.
- [ ] The playfield renderer is standalone.
- [ ] Chart data uses typed arrays.
- [ ] Visible notes are found using binary search.
- [ ] Normal frames perform zero intentional allocations.
- [ ] Timing is independent from React.
- [ ] Geometry is independent from React.
- [ ] Rendering is abstracted behind `PlayfieldDrawContext`.
- [ ] GPUIX-specific code exists only in its backend.
- [ ] A benchmark backend can run without a GPU.
- [ ] Real osu!mania charts can be loaded.
- [ ] 7K rendering works without per-note React reconciliation.
- [ ] The architecture allows a future native/GPU backend without rewriting VSRG logic.

---

# Final Principle

> **React controls the playfield. It should not render the playfield.**

React should say:

```ts
renderer.loadChart(chart);
renderer.setSongTime(time);
renderer.setScrollSpeed(speed);
renderer.setSkin(skin);
```

The renderer should handle:

```text
chart
  ↓
timing
  ↓
visibility
  ↓
geometry
  ↓
draw commands
  ↓
GPU
```

This gives Roxysu a proper rendering-engine boundary now, while keeping the door open for a true custom GPUI/GPUIX GPU playfield later.
