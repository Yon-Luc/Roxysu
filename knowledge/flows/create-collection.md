---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/src/routes/collections.ts
  - apps/server/public/features/collections
---

# Flow: Create collection

## User intent

Save a reusable practice query as a named collection.

## Flow

```
Collections UI
    ↓
POST /api/collections (query text)
    ↓
persist row in collections
    ↓
optional collection match count store refresh / query language execute for results
```

## Business guarantee

Collection definition is the query string; membership stays dynamic as the practice library grows.

## Implementation references

- `apps/server/src/routes/collections.ts`
- `collectionMatchCache.ts`
