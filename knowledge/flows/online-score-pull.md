---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/online-scores/pull.ts
  - apps/hub/src/services/osuScores.ts
  - apps/realm-reader/src/writeOnlineScores.ts
---

# Flow: Online score pull

## User intent

Add ranked personal bests from osu! that are missing in this lazer install.

## Flow

```
Settings → pick one ruleset
    ↓
Hub JWT osu id must match the lazer score user
    ↓
Hub pages scores/best (store by score id, 50/min, 4 in flight)
    ↓
preview: already / can add / current version / not installed
    ↓
confirm: lazer closed, backup client.realm
    ↓
realm.write Score rows
    ↓
upsert mirror + import row (watermark copied, not moved backward)
    ↓
analytics sessions/mastery/stats
```

## Business guarantee

No Realm write without an explicit confirm. A locked Realm aborts. A backup exists before the write. The extraction cursor does not jump backward.

## Implementation references

- `apps/server/public/features/settings/sections/OnlineScorePullSection.tsx`
- `apps/server/src/routes/onlineScores.ts`
- `apps/hub/src/routes/osuScores.ts`
- `apps/realm-reader/src/write-online-scores-once.ts`
