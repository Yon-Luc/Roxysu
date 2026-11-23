---
id: F3-013
feature: query-language
kind: logic-gap
severity: medium
confidence: verified
status: proposed
---

# Free text containing a tight colon returns HTTP 400 instead of results

## What

Searching `Re:Zero`, `Tokyo Ghoul:re` or any title or artist containing `word:word` is
classified as a structured query, then `parseFieldTerm` throws `Unknown field: re`. The
practice list and global search both answer 400 with an error string, so the map cannot be
found through the search box at all.

## Why

`looksLikeQuery` returns true on `/:\S/` without checking that the prefix is a known field
name. `parseFieldTerm`'s `default` throws instead of degrading to a text term. The feature is
documented as "plain text or the shared query DSL", but the plain-text path is unreachable
for these titles.

## How to improve

Gate `looksLikeQuery` on the known-field whitelist, reusing the field names from
`parseFieldTerm`, so unknown prefixes fall through to `toStructuredQuery`'s free-text branch.

Alternatively make `parseFieldTerm`'s `default` return `{ type: "text", value: raw }`. The
first is preferable: a typo in a real field name should still be a visible error.

## Evidence

- `apps/server/src/query-language/parse.ts:169-215` - `parseFieldTerm`
- `apps/server/src/query-language/parse.ts:412-414` - `default` throws
- `apps/server/src/query-language/parse.ts:512-528` - `looksLikeQuery` colon test
- `apps/server/src/query-language/toStructuredQuery.ts:7-12` - free-text branch
- `apps/server/src/routes/practice.ts:119-121`, `:144-150` - 400 on `QueryParseError`
