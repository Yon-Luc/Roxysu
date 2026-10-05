---
last_verified: 2026-10
confidence: verified
touches:
  - apps/server/public/features/practice/PracticeListPage.tsx
  - apps/server/public/features/practice/PracticeProfilePage.tsx
  - apps/server/public/lib/ratingDisplay.ts
  - apps/server/src/routes/practice.ts
  - apps/server/src/query-language
---

# Practice library & query language

## Purpose

Browse every played map as practice cards; filter/sort via plain text or the shared query DSL.

## Business meaning

The searchable practice catalog — same query language powers collections and global search.

## Business rules

1. Soft-deleted / `delete_pending` **sets** and scores are excluded from product queries; hidden difficulties are excluded via `hidden`.
2. Query language fields include mode, mapper, title/artist/diff, stars, key, ln, dan/sunny, mods, acc, misses, score, pp, retry, mastery, played.
3. Boolean `AND` / `OR` / `NOT`, ranges, comparisons, and `^` prefix text matches are supported.
4. Practice/search HTTP handlers read persisted Sunny dan / pattern rows only. They do not compute missing ratings on the request path. Unrated maps have null labels and miss `dan:` / `pattern:` until the Settings jobs fill the stores.
  5. `dan:` matches a map when either its Sunny label or its Daniel label matches. 4K Sunny tiers are Intro / Reform / LN; 7K Sunny tiers are Regular / LN. A Daniel row on a 4K map does not hide the Sunny tier. `daniel:` matches Daniel labels only. Bare `dan:` / `daniel:` tier names match as label tokens (not unconstrained substrings) and do not match out-of-band sentinels (`< …` / `> …`) unless the query itself starts with `<` or `>`.
6. Primary dan display on 4K prefers an in-band Daniel label (Alpha+). Out-of-band Daniel sentinels (`< …` / `> …`) fall back to Sunny so Reform / Intro / LN remain visible. **Enforced by:** `primaryDanLabel` / `primaryDanSource` in `apps/server/public/lib/ratingDisplay.ts`.
7. Username/gamemode query context is resolved once and reused until settings change or a new import lands. The retry subselect is built only when the AST uses `retry:`.
8. The map page back control returns to the previous in-app page when one exists. With no previous page it opens Practice.

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
- `apps/server/public/lib/ratingDisplay.ts:primaryDanLabel()`
- `apps/server/public/lib/ratingDisplay.ts:primaryDanSource()`

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
