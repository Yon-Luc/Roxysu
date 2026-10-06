# @roxysu/mania-difficulty

TypeScript port of the WIP osu!mania difficulty rework (`loleur362/osu` branch `mania-difficulty`).

- **Source of truth:** pinned upstream C# (`upstream/revision.json`)
- **Runtime:** Bun/Node TypeScript — no .NET required
- **Generated code:** `generated/` (do not hand-edit)
- **Dev tooling:** Roslyn transpiler + C# reference runner under `tools/`

This package is **additive** to Rating Lab / `tools/mania-rating-calc` (kept for PP and C# compare).

## Rework dan floors

`dans.json` is the source of truth for dan tiers. Edit it to add or retune a dan;
no code change is needed.

```jsonc
{
  "bands": ["low", "mid/low", "mid", "mid/high", "high"],
  "tables": {
    "4": {
      "rice": [{ "name": "Alpha", "floor": 6.9 }, { "name": "Beta", "floor": 7.2, "ceiling": 7.8 }],
      "ln":   [{ "name": "LN 13", "floor": 7.2 }]
    },
    "7": { "rice": [{ "name": "Regular Gamma", "floor": 8.7 }], "ln": [] }
  }
}
```

- A tier spans its `floor` to the next tier's floor. Only the **last** tier may set `ceiling`.
- Floors must strictly increase. The config is validated at import — an invalid file throws at boot.
- Each span is split into `bands`, so `rework:Alpha` still matches all five bands.
- Below the first floor → `< {name} {lowest band}`. Above the last ceiling → `> {name} {highest band}`.
- An empty `ln` array falls back to that key count's `rice` tiers.
- A key count with no table (6K) returns `Unknown difficulty`.

Retuning a floor only needs a **relabel**, not a re-estimate — stored stars are
re-mapped by `relabelReworkDanSync()` (`POST /api/settings/rework-dan/relabel`).

## Dominant skill

`skillProfile()` bins per-note skill strain into 2000 ms windows and returns the
whole-chart dominant skill plus a per-window leader. `packages/mania-pattern-analysis`
uses it for the active `pattern:` algorithm (`mania-skill-v1`), which replaced the
Interlude pattern families.

## Public API

```ts
import {
  calculateManiaDifficulty,
  beatmapFromOsuChart,
  DiffUtils,
} from "@roxysu/mania-difficulty";

// Lean subpath imports (no generated evaluators):
import { reworkDanLabel } from "@roxysu/mania-difficulty/dans";
import { skillProfile } from "@roxysu/mania-difficulty/skill-profile";
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
| `dans.json` | Rework dan floors (user-editable) |
| `src/dans.ts` | Floor loader, validator, label lookup |
| `src/skills.ts` | Dominant-skill classification |
| `src/skillProfile.ts` | Time-binned skill profile |
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
