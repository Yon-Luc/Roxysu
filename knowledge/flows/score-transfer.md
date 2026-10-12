---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/src/score-transfer/transfer.ts
  - apps/realm-reader/src/writeScoreTransfer.ts
---

# Flow: Score transfer

## User intent

Copy local scores to another PC so the missing ones show in lazer.

## Flow

```
Settings → export scores for the score-username filter
    ↓
roxysu-scores.json
    ↓
other PC → preview: already / can add / current version / not installed
    ↓
confirm: lazer closed, backup client.realm
    ↓
re-classify the saved file, realm.write Score rows
    ↓
upsert mirror + import row (watermark copied, not moved backward)
    ↓
analytics sessions/mastery/stats
```

## Business guarantee

No Realm write without an explicit confirm. A locked Realm aborts. A backup exists before the write. The extraction cursor does not jump backward. Scores not in the file are not deleted.

## Implementation references

- `apps/server/public/features/settings/sections/ScoreTransferSection.tsx`
- `apps/server/src/routes/scoreTransfer.ts`
- `apps/realm-reader/src/write-score-transfer-once.ts`
