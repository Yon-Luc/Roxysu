---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/collections.ts
  - apps/server/public/features/collections
---

# Flow: Create smart collection

## User intent

Save a reusable practice query as a named collection.

## Flow

```
Collections UI
    ↓
POST /api/collections (query text)
    ↓
row in collections
    ↓
optional match-count cache / QL execute for results
```

## Business guarantee

Collection definition is the query string; membership stays dynamic as the library changes.

## Implementation references

- `apps/server/src/routes/collections.ts`
- match cache helpers under server collections code
