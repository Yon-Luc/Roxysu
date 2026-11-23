---
id: F3-010
feature: query-language
kind: correctness
severity: high
confidence: verified
status: fixed
---

# A bare number after a field matches only that exact value

## What

`acc:98` compiles to `m.best_accuracy BETWEEN 0.98 AND 0.98` and `stars:5` to
`b.star_rating BETWEEN 5 AND 5`, so both return essentially nothing. The in-app help
promises the opposite: "Bare number after a field means >= that value: `acc:98`".

`pp:98` does mean >= because it never calls `parseRange`, so the same shorthand behaves
differently per field. Integer columns (`key:7`, `misses:0`, `cs:4`) survive by accident.

## Why

In `parseFieldTerm` the range branch runs first for every field. `parseRange()` maps a lone
number to `{min: n, max: n}`. The `acc`, `misses`, `score`, `stars`, `cs`, `od`, `hp`, `ln`,
`key` and `reworkstars` cases all check `r.min != null && r.max != null` before their own
`if (value.match(/^\d/)) -> op: ">="` branch, which is therefore dead code.
`compileNumericColumn` then emits `BETWEEN`.

## How to improve

Test the plain-number case before `parseRange`, or have `parseRange` return
`{op: ">=", value}` for a bare number, and delete the now-redundant branches.

Keep exact-match semantics only for `misses` and `key`, where an exact integer is the
obvious reading, and say so in the help modal.

## Evidence

- `apps/server/src/query-language/parse.ts:100-101` - bare number becomes `min = max`
- `apps/server/src/query-language/parse.ts:246-296` - `stars`, `acc` and siblings check the range first
- `apps/server/src/query-language/parse.ts:303-321` - `misses`, `score`
- `apps/server/src/query-language/compile.ts:103-105` - `BETWEEN`
- `apps/server/public/components/QueryLanguageHelpModal.tsx:296` - the documented promise

## Notes

`README.md` mostly shows explicit operators (`acc>98`, `stars:5..6`), which is why this went
unnoticed. The help modal is where a user learns the shorthand.

## Status

Fixed 2026-11-23. `parseRangeOrBare()` in `parse.ts` handles the bare number before
`parseRange`; continuous fields return `op: ">="`, `key`/`misses` keep `op: "="`, and the
now-unreachable per-field branches were deleted. Two existing assertions encoded the old
behaviour (`od:8`, `drainrate:5` expected `min = max`) and were corrected - the bug was
baked into the test suite, which is why it survived.

Tests: `parse.test.ts` "bare numeric shorthand" (five cases plus the compiled `>=` shape).
Full server suite green (1007 tests).
