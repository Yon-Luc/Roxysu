---
last_verified: 2026-09
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

## Implementation

Settings UI is tab-grouped on `/settings`:

| Tab | Sections |
|---|---|
| Setup | osu!lazer data folder, live sync, in-game overlay, tosu / live map |
| Practice | mastery formula, score username, gamemode |
| Appearance | appearance, difficulty display, preview skin, keybinds |
| Jobs | Sunny dan, Daniel dan, pattern analysis, Mania Rating Lab |

Only the active tab’s panels mount. Deep-links still use `?section=<id>` (Command Palette); optional `?tab=` selects a tab when no section is present. Tab registry: `apps/server/public/features/settings/settingsTabs.ts`.

## Important symbols

- `apps/server/src/analytics/mastery/*`
- `apps/server/src/routes/settings.ts`
- `apps/server/public/features/settings/*`
- `apps/server/public/features/settings/settingsTabs.ts`

## Dependencies

- `features/live-sync/` — practice library content for recompute

## Depended on by

- `features/practice-library/` — mastery filters
- `features/practice-profiles/`
- `features/sunny-dan-recommendations/` — backfill job from Settings

## Related knowledge

- [business/mastery-formulas.md](../../business/mastery-formulas.md)
- [business/path-resolution.md](../../business/path-resolution.md)
- [architecture/client-theme.md](../../architecture/client-theme.md) — Appearance section
