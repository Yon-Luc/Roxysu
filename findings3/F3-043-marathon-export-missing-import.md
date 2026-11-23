---
id: F3-043
feature: map-marathon
kind: correctness
severity: high
confidence: verified
status: fixed
---

# Marathon export calls `fuseManiaCharts` without importing it

## What

`apps/server/public/lib/marathonExport.ts` calls `fuseManiaCharts(...)` on the "pack" phase of
every marathon export, but the symbol was never imported. At runtime that is a
`ReferenceError: fuseManiaCharts is not defined`, thrown after the audio mix and collage work
has already been done. Every attempt to generate a marathon `.osz` fails at the last step.

## Why

The function is exported from `@roxysu/osu-chart` and correctly listed in its `index.ts`, but
the import block in `marathonExport.ts` only took `buildMarathonDebugReport` and the
`MarathonDebugReport` type.

Nothing caught it. `bun run typecheck` reported it as `TS2304`, but typecheck was not gated by
CI and nobody ran it locally, and the existing `marathonExport.test.ts` covers the audio and
WAV helpers rather than the pack phase.

## How to improve

Import the symbol. Then make the class impossible: a typecheck gate is the real fix, which is
why `.github/workflows/tests.yml` was added in the same change and `apps/play` was added to the
root `typecheck` script.

## Evidence

- `apps/server/public/lib/marathonExport.ts:303` - the call site
- `apps/server/public/lib/marathonExport.ts:1-7` - the import block without it
- `packages/osu-chart/src/fuse.ts:275` - the exported function
- `packages/osu-chart/src/index.ts:14` - the re-export

## Status

Fixed 2026-11-23. `fuseManiaCharts` added to the `@roxysu/osu-chart` import.
`bun run typecheck` now reports zero errors across the workspace, including `apps/play`.

Two other pre-existing typecheck failures were fixed in the same pass, since a gate is only
useful if it starts green:

- `apps/server/src/overlay/hostStatus.test.ts` - `ABSENT` and one local literal were widened to
  `{ state: string }`; both are now typed `OverlayHostStatus`.
- `apps/play/tsconfig.json` - `baseUrl` was rejected by the unpinned root `tsc` (TS 6 removed
  it); `paths` resolves relative to the tsconfig without it.
