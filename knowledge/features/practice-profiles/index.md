---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/features/practice/PracticeProfilePage.tsx
  - apps/server/src/routes/beatmaps.ts
---

# Practice profiles

## Purpose

Per-beatmap deep dive: cover, stats, mastery, recent scores, sessions on that map, mania Sunny/Daniel estimates, copyable in-game search string.

## Business meaning

“How am I doing on this specific map?”

## Important symbols

- `apps/server/public/features/practice/PracticeProfilePage.tsx`
- `apps/server/src/routes/beatmaps.ts`

## Dependencies

- `features/practice-library/`
- `features/mastery-settings/`
- `features/sunny-dan-recommendations/`
- `features/sessions/`

## Depended on by

- (detail surface from library / sessions)
