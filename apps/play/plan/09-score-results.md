# Score, Statistics & Results

## Goal

Produce a complete, persistent play result from gameplay state.

## Raw Statistics

Track:

```text
perfect
great
good
bad
miss
maxCombo
score
accuracy
```

Add hold-specific statistics as needed.

## Result Model

```ts
interface PlayResult {
  score: number;
  accuracy: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  bad: number;
  miss: number;
  chartId: string;
}
```

## Separation

Gameplay generates the result.

Results UI only presents it.

## Persistence

After a successful play:

```text
Gameplay
 ↓
PlayResult
 ↓
ScoreRepository
 ↓
SQLite
```

Keep database writes outside the per-frame loop.

## Roxysu Integration

Existing score/history tables can be reused where semantics match.

Use `score_metrics` and related derived structures for analytics rather than duplicating score data unnecessarily.

## Deliverable

Finishing a play produces a stable result that can be shown and persisted.
