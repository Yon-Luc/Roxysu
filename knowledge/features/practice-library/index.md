---
last_verified: 2026-04
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

**In UI:** the page is labeled Beatmaps. The route stays `/practice`.

## Business meaning

The searchable practice catalog — same query language powers collections and global search.

**In UI:** search is the first control. The best-score distribution chart is collapsed until opened, and opens again after a bar click so undo stays visible. Sort sits with the result count, above the cards.

## Business rules

1. Soft-deleted / `delete_pending` **sets** and scores are excluded from product queries; hidden difficulties are excluded via `hidden`.
2. Query language fields include mode, mapper, title/artist/diff, stars, `ar:` (`approach_rate`), `cs:` (`circle_size`), `od:` (`overall_difficulty`), `hp:` (`drain_rate`), key, ln, dan/sunny, mods, acc, misses, score, pp, retry, mastery, played.
3. `ar:` / `cs:` / `od:` / `hp:` do not imply a ruleset. `cs:` is circle size on any ruleset, not mania key count (`key:`) and not the `pattern:cs` coordination alias. Download search rejects these four fields.
4. Boolean `AND` / `OR` / `NOT`, ranges, comparisons, and `^` prefix text matches are supported.
5. Practice/search HTTP handlers read persisted Sunny dan / pattern rows only. They do not compute missing ratings on the request path. Unrated maps have null labels and miss `dan:` / `rework:` / `pattern:` until the Settings jobs fill the stores.
6. `dan:` matches a map when either its Sunny label or its Daniel label matches. 4K Sunny tiers are Intro / Reform / LN; 7K Sunny tiers are Regular / LN. A Daniel row on a 4K map does not hide the Sunny tier. `daniel:` matches Daniel labels only. Bare `dan:` / `daniel:` tier names match as label tokens (not unconstrained substrings) and do not match out-of-band sentinels (`< …` / `> …`) unless the query itself starts with `<` or `>`.
7. Primary dan display on 4K prefers an in-band Daniel label (Alpha+). Out-of-band Daniel sentinels (`< …` / `> …`) fall back to Sunny so Reform / Intro / LN remain visible. **Enforced by:** `primaryDanLabel` / `primaryDanSource` in `apps/server/public/lib/ratingDisplay.ts`.
8. Username/gamemode query context is resolved once and reused until settings change or a new import lands. The retry subselect is built only when the AST uses `retry:`.
9. Play aggregates used by Practice/Search (`play_count`, best accuracy/pp/score/misses, `last_played_at`) are read from the `mastery` row, not rebuilt from `scores` on each request. Mastery must be refreshed by analytics after imports for those fields to stay current.
10. Ruleset equality filters (`mode:`, `key:`, `ln:`, gamemode clauses) use bare `ruleset_short_name = ?` (lowercase) so SQLite can use `beatmaps_ruleset_cs_idx`.
11. The map page back control returns to the previous in-app page when one exists. With no previous page it opens Practice. The cover shows the map title only; preview, open in osu!, and more actions sit under it.

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
- `features/dashboard/` — Home “See more” opens Practice (`lastPlayed` desc)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Practice library, Query language
- [business/table-ownership.md](../../business/table-ownership.md)
