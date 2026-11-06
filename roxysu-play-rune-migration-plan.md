# Roxysu Play — Rune Migration Preparation Plan

**Status:** Preparation and validation plan  
**Target:** Evaluate replacing the current GPUIX-based UI/rendering layer with [Rune](https://github.com/anomalyco/rune)  
**Strategy:** Prototype first; preserve the existing application until Rune proves it can meet the overlay and performance requirements.

---

## 1. Goals

Prepare Roxysu Play so that a Rune-based implementation can be evaluated and, if successful, introduced without destabilizing the current application.

The migration should aim to:

- Retain the existing telemetry sources and parsing logic wherever practical.
- Keep telemetry processing independent from the UI framework.
- Reproduce the current overlay and control-window behaviour.
- Validate transparent, borderless, always-on-top and click-through windows.
- Verify multi-monitor behaviour, especially on NixOS with Niri/Wayland.
- Measure CPU, GPU, memory and frame-time overhead while osu! is running.
- Keep the current GPUIX implementation usable as a fallback until feature parity is demonstrated.

## 2. Non-goals

Do **not** make these part of the initial migration:

- Rewriting the telemetry engine merely to use Rune.
- Replacing working data formats or protocols without a demonstrated need.
- Redesigning every Roxysu Play feature during the framework migration.
- Removing GPUIX before the Rune prototype passes acceptance tests.
- Assuming that an overlay API guarantees identical behaviour on Wayland, X11 and Windows.

The first milestone is a technical feasibility test, not a complete rewrite.

---

## 3. Proposed target architecture

Keep the application divided into three responsibilities:

```text
Telemetry sources
  └── tosu / osu! telemetry / existing inputs
        |
        v
Telemetry and application core
  ├── parsing
  ├── normalized state
  ├── calculations
  ├── event handling
  └── configuration
        |
        v
UI adapter
  ├── state snapshots
  ├── incremental updates
  └── user commands
        |
        v
Rune presentation
  ├── overlay window(s)
  ├── control/settings window
  └── shared UI components
```

The core should not import Rune types. Rune should consume framework-neutral state and send framework-neutral commands back to the core.

### Suggested boundaries

| Layer | Owns | Must not own |
|---|---|---|
| Telemetry adapters | Connections, input parsing, source lifecycle | Widget state or rendering |
| Application core | Normalized state, calculations, configuration, commands | Rune/GPUIX-specific types |
| UI adapter | Mapping core events to UI updates | Telemetry parsing |
| Rune frontend | Layout, rendering, interaction, window presentation | Business logic or direct telemetry parsing |

If the existing project is not yet separated this way, introduce the boundaries incrementally before migrating screens.

---

## 4. Preparation tasks

### Phase 0 — Establish a baseline

Before changing code, record what the current GPUIX version does.

- [ ] Record the current commit and create a migration branch.
- [ ] Document the current startup and shutdown sequence.
- [ ] Inventory every window, overlay and widget.
- [ ] Record all user-facing features and keyboard shortcuts.
- [ ] Document telemetry inputs, update rates and message formats.
- [ ] Record current CPU, GPU and memory use while idle and during gameplay.
- [ ] Record frame pacing or visible stutter during gameplay.
- [ ] Capture screenshots or short recordings of representative screens.
- [ ] Record current behaviour on Niri/Wayland and any other supported desktop environments.
- [ ] Identify platform-specific code already used by GPUIX.

**Deliverable:** `docs/rune-migration/current-state.md`

Suggested inventory:

| Feature/window | Current behaviour | Data source | Platform-specific dependency | Priority |
|---|---|---|---|---|
| Main overlay | Fill in | Fill in | Fill in | High |
| Control window | Fill in | Fill in | Fill in | Medium |
| Settings | Fill in | Fill in | Fill in | Medium |
| Additional overlays | Fill in | Fill in | Fill in | As applicable |

### Phase 1 — Define requirements and acceptance criteria

Write down what “working” means before implementing the prototype.

#### Overlay behaviour

- [ ] Transparent background works where supported.
- [ ] Borderless window works.
- [ ] Always-on-top behaviour is correct.
- [ ] Click-through can be enabled and disabled at runtime.
- [ ] Overlay can be shown, hidden and repositioned.
- [ ] Overlay does not unexpectedly steal keyboard or mouse focus.
- [ ] Multiple overlays can be managed independently.
- [ ] Display changes and monitor removal do not leave windows stranded.
- [ ] Scaling and fractional scaling are tested.
- [ ] Fullscreen osu! behaviour is documented for each supported platform.

#### Telemetry behaviour

- [ ] Existing telemetry sources can be connected without changing their protocols.
- [ ] The UI can receive the latest state without blocking telemetry processing.
- [ ] Short bursts of telemetry do not create an unbounded UI queue.
- [ ] Stale or disconnected telemetry is represented clearly.
- [ ] UI updates can be coalesced without losing important state transitions.
- [ ] Rendering work does not run inside the telemetry input callback.

#### Performance behaviour

Set numerical targets after measuring the current implementation. Do not invent a performance win before comparing equivalent workloads.

Measure:

- CPU use at idle and during gameplay.
- GPU use at idle and during gameplay.
- Resident memory.
- Frame-time consistency and missed frames.
- Telemetry-to-visible-update latency.
- Startup and shutdown time.

**Deliverable:** `docs/rune-migration/acceptance-criteria.md`

### Phase 2 — Decouple the core from GPUIX

This is the most valuable preparation work because it benefits either outcome.

- [ ] Find all imports of GPUIX in the project.
- [ ] Separate telemetry parsing from UI callbacks.
- [ ] Define framework-neutral application state types.
- [ ] Define framework-neutral commands for user interactions.
- [ ] Centralize configuration and persistence.
- [ ] Make telemetry lifecycle independent of window lifecycle.
- [ ] Ensure closing or hiding a window does not accidentally stop telemetry.
- [ ] Add tests for parsing, calculations and state transitions.
- [ ] Add a small fake telemetry source for deterministic UI development.
- [ ] Add a replay fixture or recording mechanism if practical, avoiding private or sensitive gameplay data.

Possible conceptual interfaces:

```rust
// Illustrative only; adapt to the existing language and codebase.

struct AppSnapshot {
    // Framework-neutral, serializable application state.
}

enum AppCommand {
    // User actions expressed independently of the UI framework.
}

enum AppEvent {
    // State changes and lifecycle events exposed to the UI.
}
```

Do not introduce a large abstraction framework. A few stable data types and clear ownership boundaries are enough.

**Deliverable:** The existing GPUIX frontend still works, but no longer owns telemetry or business logic.

### Phase 3 — Create an isolated Rune prototype

Create a separate prototype target or application so the existing app remains runnable.

Suggested structure, to adapt to the repository's current conventions:

```text
Roxysu/
├── apps/
│   ├── play/                 # Existing implementation
│   └── play-rune/            # Experimental Rune frontend
├── crates/
│   ├── play-core/            # Framework-neutral state and logic
│   ├── play-telemetry/       # Telemetry adapters, if appropriate
│   └── play-ui-model/        # UI-facing snapshots and commands
└── docs/
    └── rune-migration/
        ├── current-state.md
        ├── acceptance-criteria.md
        ├── platform-matrix.md
        └── benchmark-results.md
```

This is a proposed layout, not a requirement to reorganize the whole repository immediately.

Prototype only:

1. A Rune window that opens and closes cleanly.
2. A transparent, borderless overlay.
3. Always-on-top behaviour.
4. Runtime click-through toggling.
5. A control window that can show/hide the overlay.
6. A fake telemetry feed updating a simple counter or status display.
7. One representative Roxysu Play widget.
8. A basic multi-monitor test.

Pin Rune to a specific revision while it is pre-release. Record the exact revision and the APIs used. Avoid depending on undocumented internals.

**Deliverable:** A small, independently runnable Rune prototype.

### Phase 4 — Platform validation

Prioritize the actual target environment before investing in a complete UI.

| Environment | What to validate |
|---|---|
| NixOS + Niri + Wayland | Transparency, placement, click-through, focus, scaling |
| NixOS + X11, if supported | Overlay and input behaviour |
| Windows, if targeted | Topmost, click-through, fullscreen behaviour |
| Other Linux compositors | Document differences rather than assuming parity |

For Wayland, explicitly investigate compositor protocol limitations. Window placement, global coordinates, focus control, input regions and fullscreen behaviour may differ from X11. If a behaviour cannot be implemented portably, decide whether to accept a platform-specific integration or drop that requirement on that platform.

Also test:

- [ ] Suspend/resume.
- [ ] Monitor hot-plugging.
- [ ] Resolution and scaling changes.
- [ ] Fullscreen and borderless-fullscreen games.
- [ ] Overlay capture in screenshots and recordings.
- [ ] GPU device loss or renderer restart, if the framework exposes recovery paths.

**Deliverable:** `docs/rune-migration/platform-matrix.md`, with each capability marked supported, limited, unsupported or not yet tested.

### Phase 5 — Performance and stability benchmark

Compare the current GPUIX implementation and Rune prototype under the same conditions.

Use the same machine, display configuration, telemetry recording, overlay contents and gameplay scenario.

| Measurement | GPUIX baseline | Rune prototype |
|---|---:|---:|
| Idle CPU | Record | Record |
| Gameplay CPU | Record | Record |
| Idle GPU | Record | Record |
| Gameplay GPU | Record | Record |
| Resident memory | Record | Record |
| UI frame-time consistency | Record | Record |
| Telemetry-to-display latency | Record | Record |
| Startup time | Record | Record |

Test at several update rates representative of real telemetry. Include a burst test and a prolonged session.

Acceptance should be based on:
- No visible gameplay interference.
- No unbounded queue growth.
- No recurring frame stalls.
- No lost or duplicated critical state transitions.
- Resource use that is acceptable relative to the current implementation.
- Stable operation over a sustained session.

Do not optimize for a benchmark that does not resemble actual gameplay.

**Deliverable:** `docs/rune-migration/benchmark-results.md` and a go/no-go decision.

---

## 5. UI migration order

Only start this after the prototype passes the platform and performance gates.

Migrate one representative feature at a time:

1. Shared typography, spacing, colours and theme tokens.
2. Basic overlay layout and positioning.
3. The simplest existing widget.
4. A widget with frequent telemetry updates.
5. A more complex widget with animation or graphs.
6. Control window and settings.
7. Multiple overlays and advanced configuration.

For every migrated feature:

- Compare it against the existing implementation.
- Verify keyboard and pointer behaviour.
- Test at different display scales.
- Test with missing, stale and rapidly changing telemetry.
- Check allocations and update frequency.
- Keep a working fallback until the feature is accepted.

Avoid a full visual redesign during the framework migration. First reproduce existing behaviour; redesign separately.

---

## 6. Rendering and telemetry rules

These rules should guide the Rune implementation:

- Keep telemetry ingestion independent from rendering.
- Store the latest state rather than queueing every visual update.
- Preserve important discrete events where dropping them would change behaviour.
- Coalesce redundant visual updates.
- Avoid unnecessary allocations in high-frequency paths.
- Do not perform database or filesystem work on the render path.
- Keep animation time-based rather than dependent on update count.
- Avoid rebuilding large UI trees when only a small value changes.
- Ensure hidden overlays do not perform needless continuous work.
- Measure before introducing custom GPU rendering code.

A useful model is:

```text
Telemetry input
    |
    v
Core state update
    |
    +----> Important event queue (ordered, bounded)
    |
    +----> Latest UI snapshot (replaceable)
                 |
                 v
          UI update scheduling
                 |
                 v
             Rune render
```

The exact scheduling API should follow Rune's current documented model rather than assuming a particular API remains stable.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rune is pre-release and APIs change | Pin a revision; isolate Rune-specific code |
| Wayland limits overlay control | Test Niri first; document platform-specific limits |
| Click-through behaves differently by platform | Make it an explicit acceptance test |
| UI rewrite takes longer than expected | Migrate incrementally; retain GPUIX |
| High-frequency updates waste resources | Separate state ingestion from render scheduling |
| Renderer or compositor bugs affect gameplay | Keep a quick fallback to the existing app |
| Feature parity is underestimated | Maintain a feature inventory and regression checklist |
| Rust UI iteration is slower than React | Prototype the most interaction-heavy screen early |

---

## 8. Suggested milestones

These are planning estimates for a solo developer, not guarantees.

| Milestone | Expected effort | Exit condition |
|---|---:|---|
| Baseline and feature inventory | 0.5–2 days | Existing behaviour documented |
| Core/UI separation | 2–5 days | Existing app still works with isolated core |
| Rune window and overlay prototype | 2–5 days | Basic overlay and control window work |
| Platform validation | 2–7 days | Niri/Wayland limitations understood |
| Telemetry and rendering benchmark | 1–3 days | Comparable measurements collected |
| Go/no-go review | 0.5 day | Migration decision documented |

Do not commit to a full rewrite schedule until these milestones are complete.

---

## 9. Go/no-go decision

Proceed with a full Rune migration only if all of the following are true:

- [ ] The Rune prototype can display the required overlay on the primary target environment.
- [ ] Click-through and focus behaviour are acceptable.
- [ ] Multi-monitor behaviour is acceptable for the supported setup.
- [ ] Telemetry remains responsive under load.
- [ ] Performance is at least acceptable compared with GPUIX.
- [ ] The required UI interactions can be implemented without excessive workarounds.
- [ ] Rune's release and maintenance trajectory is acceptable for the project.
- [ ] The existing implementation can remain available during migration.

If one of the critical platform requirements fails, keep GPUIX and consider using Rune only for a limited experiment. A framework switch is not worthwhile if it compromises the overlay's reliability during gameplay.

## 10. First practical work session

Start with this small sequence:

1. Create a migration branch.
2. Write down the current overlay features and shortcuts.
3. Capture a baseline screenshot and resource measurements.
4. Build a separate Rune window using a pinned Rune revision.
5. Test transparency, always-on-top and click-through on Niri.
6. Feed it fake telemetry and display one changing value.
7. Compare the result with the current implementation.
8. Record every limitation before adding more features.

**The first success criterion is not a beautiful overlay. It is proving that Rune can reliably create and manage the exact kind of overlay Roxysu Play needs on your actual desktop.**
