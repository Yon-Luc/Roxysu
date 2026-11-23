# Findings 3

Read-only audit of the working tree on 2026-11-23. Eight reviewers took one subsystem
each, read the code path end to end, and cross-checked `findings/` (80 notes) and
`findings2/` (24 candidates) so closed work was not re-reported.

Every note carries a `file:line` the reviewer read. The seven headline claims were
re-verified against source by a separate pass, and the analytics claims were validated
against a read-only copy of the local mirror.

Severity is user-facing cost, not patch size. `confidence: verified` means the code path
was read in full; a finding that depends on timing is marked `inferred` in that section.

## Status

31 notes are `status: proposed`. Eleven are `status: fixed` (2026-11-23): F3-001, F3-005, F3-006, F3-007, F3-008, F3-011, F3-015,
F3-010, F3-033, F3-038 and F3-043, each verified by the full server suite (1023 tests) and,
where it applies, the realm-reader suite (51 tests).

## Counts

| Severity | Count |
| --- | --- |
| high | 7 |
| medium | 20 |
| low | 16 |

## Fix first

| Id | Feature | Kind | Title |
| --- | --- | --- | --- |
| [F3-005](F3-005-failed-plays-ranked-as-pb.md) | analytics | correctness | Failed plays are ranked as PB and given a fabricated PP |
| [F3-001](F3-001-score-writeback-success-import-row.md) | live-sync | correctness | Score write-back inserts its own `success` import row |
| [F3-010](F3-010-bare-number-exact-match.md) | query-language | correctness | A bare number after a field matches only that exact value |
| [F3-033](F3-033-tosu-spawn-error-crashes-server.md) | tosu-live | correctness | Tosu auto-start can kill the server process |
| [F3-038](F3-038-reverse-slider-ticks-unmirrored.md) | preview-replay | correctness | Reverse-slider ticks are paired with the wrong path position |
| [F3-015](F3-015-comfort-from-failed-plays.md) | rework-dan | correctness | Comfort skill is computed from plays the player failed |
| [F3-043](F3-043-marathon-export-missing-import.md) | map-marathon | correctness | Marathon export calls `fuseManiaCharts` without importing it |

## By feature

- **live-sync:** F3-001, F3-002, F3-003, F3-004
- **analytics:** F3-005, F3-006, F3-007, F3-008, F3-009
- **query-language / collections:** F3-010, F3-011, F3-012, F3-013, F3-014
- **rework-dan:** F3-015, F3-016, F3-017, F3-018, F3-019, F3-020
- **hub / mirrors:** F3-021, F3-022, F3-023, F3-024, F3-025, F3-026
- **client-ui:** F3-027, F3-028, F3-029, F3-030, F3-031, F3-032
- **desktop / tosu / overlay:** F3-033, F3-034, F3-035, F3-036, F3-037
- **preview-replay / skins / marathon:** F3-038, F3-039, F3-040, F3-041, F3-042, F3-043

## Five root causes

The notes cluster. The cluster is the actionable unit; fixing one instance leaves the
class alive.

### 1. Client-supplied numbers become authoritative (HUB)

F-041 was closed by deriving accuracy from judgements, but the divisor is still the
client's `maxExScore`. Ingest also has no rate limit and dedupes on a client-chosen
`installationId`. See F3-022, F3-023.

### 2. Cross-process state encoded in one row (live-sync, analytics)

Both processes infer cluster-wide truth from the highest `imports` id and from a stored
`sessions.score_count` snapshot. Any writer outside the protocol lies to every reader:
write-back can mask a running import (F3-001), a dead cycle's rows are never announced
(F3-002), and orphan deletes never decrement the count (F3-007).

### 3. Event-based invalidation is incomplete (rework-dan, collections, UI)

A store refreshes on some events but not others. Collection match counts listen only to
`sync.finished` and `mastery.updated` (F3-012); variants survive a formula pin change
(F3-016); nothing invalidates `["practice"]` when ratings change locally (F3-019);
the Sessions list never refreshes per play (F3-030).

### 4. The same number computed twice, differently (analytics, query, UI)

Play count (F3-008), best play per map (F3-006), and pattern matching (F3-011) each have
two implementations that disagree. Extracting one predicate or candidate builder per
concept eliminates the whole class.

### 5. Unbounded work on a shared hot path (replay, live-sync, skins, marathon)

Mania judging is O(frames x notes) synchronously (F3-040); orphan deletion runs inside
the commit transaction (F3-004); skin archives inflate without a budget (F3-041,
F3-042); shutdown polls full-table coverage queries (F3-037).

## findings2 has rotted

`findings2/regression-check.md` never ran Phase 3, so its 24 candidates still read as
live. Re-verified as **fixed** in this tree, by this audit:

`A2`, `A3`, `A4`, `B2`, `B3`, `B4`, `B5`, `B6`, `D1`, `D2`, `D4`, `D5`, `D6`, `D7`,
`E1`, `E2`, `E3`, `G5`, `G6`, `G7`.

Still genuinely open:

| Id | Why it survived |
| --- | --- |
| `A1` | The heartbeat landed, but F3-001's synthetic `success` row still bypasses the gate |
| `D3` | Reopens as F3-022: the trust gap moved from `accuracy` to `maxExScore` |
| `G4` | Reopens as F3-037: the getters are still full-table coverage queries |
| `B1` | Reopens as the remaining WAV/zip/Blob copies in marathon export |

## Out of scope for any feature owner

Two process gaps sit outside every subsystem above. Both are fixed as of 2026-11-23:

1. **CI never ran the tests or typecheck.** Three workflows existed (desktop Linux,
   desktop Windows, docs); all built or packaged, none ran `bun test` or
   `bun run typecheck`. Added `.github/workflows/tests.yml`.
2. **`apps/play` was excluded from root `typecheck`** (135 TypeScript files). Added to the
   root script; it typechecks clean under both the root and its own pinned compiler.

Turning the gate on immediately found F3-043, a marathon export path that had been throwing
`ReferenceError` at runtime because a symbol was never imported, plus two smaller type errors
that had drifted unnoticed.

Still open: the root `typecheck` script uses `bunx tsc`, which is **unpinned** (no
`typescript` devDependency at the root), so the compiler version can change under the gate at
any time. Pinning it is a one-line change to `package.json` plus a lockfile update, and is the
next step for making the gate reproducible.

## Needs a decision, not a patch

1. **HR circle-size scaling.** Standard does not scale CS under HR; catch does; lazer
   scales osu! CS by 1.3. Standard HR hit radius may be systematically too generous.
2. **Push band semantics.** The model is `topN` of the hardest band maps, but the gate
   requires 30 maps per axis inside a 5-point band while the summary reports the overall
   peak (F3-020). `todo.txt` asks for configurable 90-95% thresholds.
3. **Hub trust policy.** Whether non-Roxysu clients may submit community scores at all
   is a policy call that precedes F3-022.
