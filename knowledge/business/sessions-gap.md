---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/analytics/session.ts
---

# Sessions gap

## Business rules

1. Scores are grouped into sessions; a gap greater than **30 minutes** (`SESSION_GAP_MS = 30 * 60 * 1000`) starts a new session.

**Status:** verified
