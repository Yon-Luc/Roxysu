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

**In UI:** the page is labeled Beatmaps. The route stays `/practice`.

## Business meaning

The searchable practice catalog — same query language powers collections and global search.

**In UI:** search is the first control. The best-score distribution chart is collapsed until opened, and opens again after a bar click so undo stays visible. Sort sits with the result count, above the cards.

## Business rules

1. Soft-deleted / `delete_pending` **sets** and scores are excluded from product queries; hidden difficulties are excluded via `hidden`.
2. Query language fields include mode, mapper, title/artist/diff, stars, `ar:` (`approach_rate`), `cs:` (`circle_size`), `od:` (`overall_difficulty`), `hp:` (`drain_rate`), key, ln, `dan:` / `rework:` / `reworkstars:`, mods, acc, misses, score, pp, retry, mastery, played. `sunny:`, `daniel:`, `danstars`, and `sunnystars` are removed.
3. `ar:` / `cs:` / `od:` / `hp:` do not imply a ruleset. `cs:` is circle size on any ruleset, not mania key count (`key:`) and not `pattern:cs` (chart shape chordstream). Download search rejects these four fields.
4. Boolean `AND` / `OR` / `NOT`, ranges, comparisons, and `^` prefix text matches are supported.
5. Practice/search HTTP handlers read persisted rework dan / pattern rows only. They do not compute missing ratings on the request path. Unrated maps have null labels and miss `dan:` / `rework:` / `pattern:` until the Settings jobs fill the stores. `pattern:speed` and `pattern:jack` match the dominant skill. `pattern:technical` matches the technical skill. `pattern:jumpstream`, `pattern:chordstream`, `pattern:chordjack`, `pattern:bracket`, `pattern:handstream`, `pattern:stream`, `pattern:trill`, `pattern:jumptrill`, `pattern:anchor`, `pattern:shield`, and `pattern:tech` match chart shape. Chart-shape families are keymode-scoped (`shapesForKeyCount`): jumpstream and handstream only label 4K maps, bracket only non-4K, so `key=7 pattern:jumpstream` matches nothing once rows are relabeled. `pattern:delay` matches stream. `pattern:tech` is the mixed chart shape, not the technical skill. A row with a skill and a null shape still matches skill queries; shape queries miss it until the pattern job fills `shape_pattern`.
6. `dan:` is an alias of `rework:`: both match `algorithm = 'mania-difficulty'` labels via `expandReworkDanMatch` on `dr_r`. `axis:` uses rework `ln_ratio` (`dr_r`).
7. Rating display modes are `osu` | `rework` only. Stored prefs `dan` / `sunny` migrate to `rework`. **Enforced by:** `parseMode` / `primaryDanSource` / `formatPrimaryRating` in `apps/server/public/lib/ratingDisplay.ts`.
8. Username/gamemode query context is resolved once and reused until settings change or a new import lands. The retry subselect is built only when the AST uses `retry:`.
9. Play aggregates used by Practice/Search (`play_count`, best accuracy/pp/score/misses, `last_played_at`) are read from the `mastery` row, not rebuilt from `scores` on each request. Mastery must be refreshed by analytics after imports for those fields to stay current.
10. Ruleset equality filters (`mode:`, `key:`, `ln:`, gamemode clauses) use bare `ruleset_short_name = ?` (lowercase) so SQLite can use `beatmaps_ruleset_cs_idx`. `mode:catch` and `mode:ctb` compile to the stored short name `fruits`.
11. The map page back control returns to the previous in-app page when one exists. With no previous page it opens Practice. The cover shows the map title only; preview, open in osu!, and more actions sit under it.
12. Changing page, sort, or query keeps the previous cards and result count on screen and dims the grid (`aria-busy`) until the new result arrives; the skeleton shows only on the first load. Page buttons are disabled while the shown result is stale, and the distribution chart query starts only after the list resolves.
13. Practice and collection result cards (`rx-card rx-card-grid`) animate only `transform` and `opacity` on hover (accent ring and tint on a pseudo-element). Hover styling applies only under `@media (hover: hover)`. See `architecture/client-theme.md`.

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
- `features/rework-dan-recommendations/` — `dan:` / `rework:` fields when rework dan rows are populated
- `features/mastery-settings/` — mastery field values

## Depended on by

- `features/smart-collections/` — collections store query text
- `features/sessions/` — Up Next suggest uses query language filters
- `features/map-marathon/` — search to add maps
- `features/dashboard/` — Home “See more” opens Practice (`lastPlayed` desc)

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Practice library, Query language
- [business/table-ownership.md](../../business/table-ownership.md)
