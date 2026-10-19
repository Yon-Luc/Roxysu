---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/analytics/session.ts
---

# Sessions gap

## Business rules

1. Scores are grouped into sessions; a gap greater than **30 minutes** (`SESSION_GAP_MS = 30 * 60 * 1000`) starts a new session.
2. Because sessions are defined by gaps in the global timeline, new scores can only reshape sessions within one gap of them; `tryRepairSessionDelta` repairs just those sessions and must produce the same partition as a full rebuild (`runSessionEngine` without `scoreIds`).

**Status:** verified
