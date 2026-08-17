---
last_verified: 2026-08
confidence: verified
touches:
  - apps/server/public/features/practice/PracticeListPage.tsx
  - apps/server/src/routes/practice.ts
  - apps/server/src/query-language
---

# Practice library & query language

## Purpose

Browse every played map as practice cards; filter/sort via plain text or the shared query DSL.

## Business meaning

The searchable practice catalog — same query language powers collections and global search.

## Business rules

1. Soft-deleted / `delete_pending` maps and scores are excluded from product queries.
2. Query language fields include mode, mapper, title/artist/diff, stars, key, ln, dan/sunny, mods, acc, misses, score, pp, retry, mastery, played.
3. Boolean `AND` / `OR` / `NOT`, ranges, comparisons, and `^` prefix text matches are supported.

## Main flows

```
user query string
    ↓
parse → compile → SQL execute
    ↓
practice list / collection match / search
```

## Important symbols

- `apps/server/src/query-language/*`
- `apps/server/src/routes/practice.ts`
- `apps/server/public/features/practice/PracticeListPage.tsx`

## Dependencies

- `features/live-sync/` — practice library content from Realm extraction
- `features/sunny-dan-recommendations/` — `dan:` / `sunny:` fields when Sunny dan ratings store is populated
- `features/mastery-settings/` — mastery field values

## Depended on by

- `features/smart-collections/` — collections store query text
- `features/sessions/` — Up Next suggest uses query language filters
- `features/map-marathon/` — search to add maps

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Practice library, Query language
- [business/table-ownership.md](../../business/table-ownership.md)
