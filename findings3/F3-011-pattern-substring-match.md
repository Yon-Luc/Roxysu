---
id: F3-011
feature: query-language
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# `pattern:stream` and `pattern:trill` match their sibling shapes as substrings

## What

`pattern:stream` emits `LIKE '%stream%'` against `pa.shape_pattern` and
`pa.secondary_shape`, so it also returns `chordstream`, `jumpstream` and `handstream` rows.
`pattern:trill` returns `jumptrill`.

The Patterns modal counts each family exactly (`GROUP BY pattern`, `= ?` for samples), so
clicking a "Stream - 40" card opens a practice list with more maps than the card promised.

## Why

`compileTerm`'s `pattern` case builds `likePattern(term.value, term.prefix)`, which is
`%value%` unless `^` was typed. Chart-shape labels are prefix-related to each other, so
substring matching cannot separate them. `patternSummary.ts` uses exact equality and
`GROUP BY`; the two paths disagree by construction.

## How to improve

In `compileTerm` case `pattern`, match shape labels with `=`/`IN` - they are a closed
vocabulary from `shapesForKeyCount` - and keep `LIKE` only when `term.prefix` is set. Do the
same for the skill columns.

## Evidence

- `apps/server/src/query-language/compile.ts:28-31`, `:251-265` - `likePattern` on shape columns
- `apps/server/src/query-language/patternSummary.ts:86-90`, `:214-244`, `:339-346` - exact match
- `packages/mania-difficulty/src/shape.ts:50-83` - the closed label set
