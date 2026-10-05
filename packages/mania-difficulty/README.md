# @roxysu/mania-difficulty

TypeScript port of the WIP osu!mania difficulty rework (`loleur362/osu` branch `mania-difficulty`).

- **Source of truth:** pinned upstream C# (`upstream/revision.json`)
- **Runtime:** Bun/Node TypeScript — no .NET required
- **Generated code:** `generated/` (do not hand-edit)
- **Dev tooling:** Roslyn transpiler + C# reference runner under `tools/`

This package is **additive** to Rating Lab / `tools/mania-rating-calc` (kept for PP and C# compare).

## Public API

```ts
import {
  calculateManiaDifficulty,
  beatmapFromOsuChart,
  DiffUtils,
} from "@roxysu/mania-difficulty";
```

`calculateManiaDifficulty` pipeline:

1. Handwritten hit-object graph (`buildHitObjectGraph`)
2. **Generated** evaluators (Speed / Technical / Jack / Coordination / Release)
3. Handwritten processors + `ManiaSkill` accuracy curves + Total combination
   (matches `CreateDifficultyAttributes` structure)

Includes pattern preprocessor (roll/jumptrill/mash/vibro/endurance) and C#-faithful
hit-object construction (skip first note, ColumnDelta null-coalesce, chord/hold arrays).

Fixture parity (vs pinned C# baselines): SR and main skills within ~0.1% on synthetic
maps. Score-loss polynomial coeffs still not emitted.

Generated modules (v0.3): utils + all five evaluators (+ Jack/* helpers).

## Developer commands

```bash
# Pin local upstream checkout to revision.json SHA
bun run upstream:pin

# Regenerate TypeScript from generateRoots
MANIA_DIFFICULTY_UPSTREAM=… bun run port:generate

# Smoke-check generated DiffUtils + API stub
bun run port:verify

# Prove unsupported C# fails without clobbering generated/
bun run port:probe

# Unit + soft parity tests
bun test

# Dependency report
bun run port:report

# C# reference (difficulty-only JSON) — needs OSU_GAME_PATH
OSU_GAME_PATH=/path/to/checkout dotnet run --project tools/ReferenceRunner -- \
  --sha $(jq -r .sha upstream/revision.json) \
  tests/fixtures/synthetic-4k-sparse.osu
```

## Layout

| Path | Role |
|---|---|
| `src/` | Handwritten API + adapters |
| `generated/` | Transpiler output (committed) |
| `tools/Transpiler` | Constrained Roslyn C#→TS |
| `tools/ReferenceRunner` | C# difficulty JSON oracle |
| `upstream/revision.json` | Pinned repo/branch/SHA |
| `docs/dependency-report.md` | generate / shim / out-of-scope |

## Upstream pin

```json
{
  "repository": "https://github.com/loleur362/osu",
  "branch": "mania-difficulty",
  "sha": "e6207616bd732c7c00207a060f31cf7729f8390b"
}
```

Do **not** track `loleur362/master` (ppy tip). Updates are candidate SHAs on `mania-difficulty` only.
