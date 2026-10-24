---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/tosu
  - apps/server/src/tosu/status.ts
  - apps/server/src/tosu/spawnGate.ts
  - apps/server/src/tosu/live.ts
  - apps/server/src/tosu/client.ts
  - apps/server/src/routes/tosu.ts
  - apps/server/src/index.ts
  - apps/server/public/lib/useTosuLiveQuery.ts
  - apps/server/public/lib/sse.ts
  - apps/server/public/features/sessions/SessionTosuLivePanel.tsx
  - apps/server/public/features/now-selected
---

# tosu live

## Purpose

Optional WebSocket integration with **tosu** for live in-progress map state (overlay / live UI hints).

## Business rules

1. tosu is **not** the score source of truth — Realm extraction → local mirror remains authoritative for plays.
2. The lean snapshot (`GET /api/tosu/live`) stays small — it is published on play ticks. Full mania pattern detail is cached on checksum change and served separately (`GET /api/tosu/live/analysis`).
3. `tosu.updated` SSE is `{ reason: "play" | "full", ... }`. Play ticks (rate-limited to 500ms) patch play + beatmap state + `beatmapTimeMs` (tosu `beatmap.time.live`, ms) in the client cache. Full invalidation is for checksum/status changes. A play tick that arrives before any live snapshot is cached (cold load) refetches `/api/tosu/live` instead of being dropped (`applyTosuUpdated` in `public/lib/sse.ts`).
4. Client HTTP poll of the lean snapshot is a reconnect fallback only (`useTosuLiveQuery`); it also runs when the cached snapshot reports disabled (slower interval), so a wrongly cached "adapter off" state self-heals instead of wedging. The Current session panel does not poll while hidden.
5. The adapter must be bootstrapped before `/api/tosu/live` is served — `getTosuLiveSnapshot()` reads module-level settings that only adapter init populates, so an uninitialized read reports `enabled: false`. Both entry points (`src/index.ts` Bun, `src/index.node.ts` Node/desktop) call `void ensureTosuStarted(db)` at boot, and the route awaits the same guarded promise (`ensureTosuStarted` in `src/tosu/live.ts`).
6. Live mania analysis includes an ephemeral rework (`analysis.rework`) estimate from the selected chart’s `.osu` text (rate + Invert/`lnOnly`-aware; never persisted). Hold Off is not applied on this path. The Current session **Now selected** panel and `/now-selected` page show the rework label.
7. Live DIFF/dan requires tosu HTTP for selection + `.osu` fetch (`/files/beatmap/file` or local-mirror fallback). Third-party ManiaMapAnalyser under tosu static is **not** part of Roxysu live analysis and is not probed.
8. Mania key count comes from tosu v2 `stats.cs`, which is a number or `{ original, converted }`; `keysFromCs` (`src/tosu/client.ts`) prefers an integer `converted` in 1-10, else `original`. Same rule as the **Tosu counter**.
9. Auto-start never stacks tosu processes. `decideSpawn` (`src/tosu/spawnGate.ts`) skips a spawn while the previously spawned pid is alive, backs off 60 s then 120 s between attempts, and stops after 3 consecutive attempts, pushing a warning to the live warnings list in each case. A reachable HTTP probe, or a manual `POST /api/tosu/start`, resets the gate. Detached tosu children are still not killed on Roxysu shutdown.
10. The 15 s probe loop only refreshes warnings. It publishes `tosu.updated` (`full`) only when the warning list changed; beatmap, play and analysis changes publish themselves.
11. An in-flight HTTP probe must not spawn tosu or rewrite warnings after live is stopped or reloaded disabled. `startTosuAdapter` and `stopTosuAdapter` bump `probeEpoch` before any await; `refreshProbeAndMaybeSpawn` bails after the probe if that epoch moved, settings are disabled, or the db is gone.

## Important symbols

- `apps/server/src/tosu/*`
- `apps/server/src/tosu/spawnGate.ts:decideSpawn()` — auto-start gate
- `apps/server/src/tosu/client.ts:keysFromCs()`, `parseTosuV2Message()`
- `apps/server/public/lib/sse.ts:applyTosuUpdated()`
- `apps/server/src/routes/tosu.ts` — `/live`, `/live/analysis`, `/start`
- `apps/server/public/lib/useTosuLiveQuery.ts`

## Dependencies

- external tosu process (root `dev` script)

## Depended on by

- `features/sessions/` — Current session **Now selected** panel
- `features/now-selected/` — second-monitor Now selected page
- `features/overlay-editor/` — Overlay triggers / live elements on the `/overlay` HUD
