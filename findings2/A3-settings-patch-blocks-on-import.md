---
cand: A3
reopens: F-002
feature: cross-cutting
kind: correctness
severity: low
confidence: verified
status: proposed
---

# Settings PATCH blocks behind a running import

## Problem

When the score username or gamemode filter changes, `PATCH /api/settings` awaits `runAnalyticsPipeline(db, { forceFull: true })`. If this call owns the run, the first step is `waitForIdleImport`, which polls until `importGateDecision` says proceed or shutdown.

That wait is not unbounded, and it does not return `{ pending: true }`. Proceed means the latest import is not `running`, or it is `running` and already stale. Today that is at most the time left until `started_at + 10 min`. An in-flight run returns before the wait (`pending = true` on the module flag). The PATCH still responds with the normal settings body, and the in-flight run picks up `pendingForceFull` on its next loop.

The blocking case is real: no pipeline in flight, latest import `running` and younger than the stale window. The handler holds the request for the rest of that window.

## Potential solution

Do not await the pipeline on this route. After the settings write and the two cache invalidations:

```ts
void runAnalyticsPipeline(db, { forceFull: true });
publish({ type: "dashboard.updated" });
publish({ type: "mastery.updated" });
return buildSettingsResponse(db);
```

The UI already refreshes from those events. A 202 is unnecessary.

This must ship with A1. A heartbeat removes the `started_at + 10 min` ceiling, so the same `await` would then hold the PATCH until a long import finishes.

If a run is already in flight, the existing `pending` / `pendingForceFull` flag still coalesces this request. Fire-and-forget does not start a second pipeline.

## Do not

- Do not add a wait cap that proceeds into a rebuild. That is the F-002 bug.
- Do not skip the forced full rebuild. The filter change still has to rebuild. It just must not block the response.

## Touch

- `apps/server/src/routes/settings.ts` around the `scoresFilterChanged` branch

## Tests

Route test: with a young `running` import and no in-flight pipeline, the PATCH returns without waiting out the stale window, and a later idle tick still runs a full rebuild (`pendingForceFull` or a started run). A second PATCH while a run is in flight does not start another.
