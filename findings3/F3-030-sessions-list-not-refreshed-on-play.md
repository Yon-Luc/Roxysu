---
id: F3-030
feature: sessions
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# A new play never refreshes the Sessions list, only the current-session detail

## What

While a session is live, `/sessions` keeps showing the old play count on the "now playing" card
and on the current row, plus stale calendar day counts, even though the play arrived over SSE.

The detail page `/sessions/current` does tick, so the two disagree if both are open. This
contradicts `knowledge/features/sessions` rule 2.

## Why

`onScoreImported` invalidates `["sessions","current"]` as a prefix and `["sessions"]` exactly.
The list's key is `["sessions", tzOffset, todayKey]`, which neither matches. Only
`session.started`/`session.finished` invalidate it non-exactly, so per-play updates miss the
list.

## How to improve

Invalidate the list keys with a predicate, for example
`predicate: q => q.queryKey[0] === "sessions" && typeof q.queryKey[1] === "number"`, so closed
session detail keys stay cached. Alternatively give the list its own prefix.

## Evidence

- `apps/server/public/lib/sse.ts:99-123` - the two invalidations
- `apps/server/public/features/sessions/SessionsPage.tsx:31-34` - list key
- `apps/server/public/features/sessions/SessionsPage.tsx:125-137` - counts rendered from it
- `apps/server/public/features/sessions/SessionDetailPage.tsx:43-51` - detail key that does tick
