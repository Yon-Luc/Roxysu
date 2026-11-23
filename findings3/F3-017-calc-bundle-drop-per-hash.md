---
id: F3-017
feature: hub
kind: correctness
severity: medium
confidence: verified
status: proposed
---

# Packaged replace-then-drop vouches per hash, not per (hash, algorithm)

## What

`dropCalcBundleLeftovers` builds one temp table of file hashes and applies the same
`NOT IN (hash)` predicate to both bundle tables. A map that the shipped file covers with a
pattern entry but no dan entry keeps the previous formula's star - exactly the survival
`decisions/hub-calc-bundle-version.md` forbids.

## Why

Divergence between the two exports is reachable. `danExportPredicate` requires
`est_diff IS NOT NULL AND error IS NULL`, while the pattern-row writer `computeOnePattern`
can succeed for a map whose dan row previously failed (file missing then, present now). The
decision's intent is per-algorithm coverage; the implementation is per-hash membership.

## How to improve

Insert `(hash, algorithm)` pairs into the temp table and delete with
`NOT EXISTS (SELECT 1 ... WHERE hash = beatmap_hash AND algorithm = <that algorithm>)`, one
statement per table, instead of one shared hash set.

## Evidence

- `apps/server/src/map-analysis/calcBundle.ts:460-476` - shared hash temp table
- `apps/server/src/map-analysis/calcBundle.ts:493-516` - the two `NOT IN` deletes
- `apps/server/src/map-analysis/calcBundle.ts:138-159` - dan export predicate
- `apps/server/src/map-analysis/calcBundle.ts:531-558` - pattern export
- `knowledge/decisions/hub-calc-bundle-version.md` - full formula authority per version
