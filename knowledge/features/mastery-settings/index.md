---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/analytics/mastery
  - apps/server/src/routes/settings.ts
  - apps/server/public/features/settings
---

# Mastery & settings

## Purpose

Choose mastery formula (`simple` or `practice`), rating display preference (osu! stars / Sunny dan / Sunny rework stars), paths, and background jobs (Sunny/Daniel backfill). Recompute mastery across the practice library when formula changes.

## Business rules

1. Mastery formula is a setting; switching triggers recompute.
2. Path resolution precedence: env → Settings → platform default (`packages/osu-paths`).

## Important symbols

- `apps/server/src/analytics/mastery/*`
- `apps/server/src/routes/settings.ts`
- `apps/server/public/features/settings/*`

## Dependencies

- `features/live-sync/` — practice library content for recompute

## Depended on by

- `features/practice-library/` — mastery filters
- `features/practice-profiles/`
- `features/sunny-dan-recommendations/` — backfill job from Settings

## Related knowledge

- [business/mastery-formulas.md](../../business/mastery-formulas.md)
- [business/path-resolution.md](../../business/path-resolution.md)
