---
id: F3-018
feature: hub
kind: logic-gap
severity: medium
confidence: verified
status: proposed
---

# Dropped-row recompute debt is in memory only, and the applied marker is written first

## What

After a packaged boot drops previous-formula rows, the missing backfill starts only because
`droppedLeftovers > 0` is still live in the promise result.
`setCalcBundleAppliedVersion` runs before that signal reaches the entry point, and
`maybePullCalcBundleOnBoot` returns `droppedLeftovers: 0` on every later boot.

A quit or crash during the apply, or any interruption of the backfill, strands the dropped
maps as simply "missing": no persisted debt, no auto-resume. The beatmap page shows no star
and recommendations silently exclude them.

## Why

There is no stored "backfill owed" flag. The boot decision is derived from an ephemeral
number computed after the marker is written. `nulledShapes` and the pattern job have the
same shape.

## How to improve

Persist the dropped count, or a `jobs.rework_backfill_owed` setting, in the same transaction
as the apply. Have the entry points resume the backfill whenever coverage `missing > 0`
after a boot apply, and clear the flag when it finishes.

## Evidence

- `apps/server/src/map-analysis/calcBundle.ts:864-884` - dropped count from the in-memory result
- `apps/server/src/map-analysis/calcBundle.ts:909-919` - marker written first
- `apps/server/src/index.ts:69-74` - boot entry point
- `apps/server/src/index.node.ts:83-86` - same
