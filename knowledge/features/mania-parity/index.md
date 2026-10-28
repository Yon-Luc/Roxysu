---
last_verified: 2026-10-28
confidence: inferred
touches:
  - apps/server/src/mania-parity
  - apps/server/src/routes/maniaParity.ts
  - apps/server/src/routes/system.ts
  - apps/server/public/features/mania-parity/ManiaParityPage.tsx
  - packages/mania-difficulty
---

# Mania difficulty port compare

## Purpose

Dev-only client app page that scores a query or a Collection against the **mania difficulty port** and the pinned C# reference runner, and shows skill deltas. Not a product surface for other players.

## Access

The page and `POST /api/dev/mania-parity/compare` are available only when one of these is true:

1. The running process can see the repo checkout that contains `packages/mania-difficulty/upstream/revision.json` (dev folder).
2. The client app score-username filter resolves to `Noy`, or that is the most common local score username when the filter is all.
3. The request carries a Hub bearer whose `/auth/me` username is `Noy`.

Nav and the command palette also show the link when system status `devParity` is true, or when the Hub session username is `Noy`. A direct URL on any other install gets a locked page; the compare route returns 404.

This is a visibility gate, not client app authentication. The client app API still has no auth.

## Behavior

- Input is a practice-library query, a preset (7K LN dan practice sets), or a smart Collection query. Limit 1–40, default 16.
- Only mania charts with a lazer file and at least 8 objects are scored. The C# process receives that resolved file path, never a caller-supplied path.
- Nomod. Tolerance matches the port fixtures: 2% relative or 0.05 absolute. Note and hold counts must match exactly.
- The C# side is `dotnet exec` of `tools/ReferenceRunner` at the pinned SHA. If the dll or `dotnet` is missing, compare returns 409.

## Depended on by

- None. Does not write the Dan ratings store.
