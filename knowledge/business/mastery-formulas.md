---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/analytics/mastery
  - docs/architecture.md
---

# Mastery level

## Business rules

1. Mastery `level` is a fixed blend of best accuracy (50%), log-scaled play count (25%), and best PP (25%), clamped to 0–100.
2. The analytics pipeline recomputes mastery when scores change; there is no user-selectable formula.

**Status:** verified
**See:** `apps/server/src/analytics/mastery/formulas/simple.ts:computeSimpleMastery()`
