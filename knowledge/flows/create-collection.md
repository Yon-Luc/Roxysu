---
last_verified: 2026-10-30
confidence: verified
touches:
  - apps/server/src/routes/collections.ts
  - apps/server/src/shared/collectionBatch.ts
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
optional collection match count store refresh (yields between collections after import)
```

Generate collections uses the same definition, in one request. The generator opens in a modal; the page stays the single-query form.

```
Generate modal (stars, accuracy, or rework dan)
    ↓
POST /api/collections/batch
    ↓
skip names that already exist; persist the rest
    ↓
background match-count refresh
```

## Business guarantee

Collection definition is the query string; membership stays dynamic as the practice library grows.

## Implementation references

- `apps/server/src/routes/collections.ts`
- `apps/server/src/shared/collectionBatch.ts`
- `apps/server/public/features/collections/GenerateCollectionsModal.tsx`
- `apps/server/public/features/collections/generateCollections.ts`
- `collectionMatchCache.ts`
