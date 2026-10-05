# Mania difficulty dependency report

- **Upstream:** https://github.com/loleur362/osu
- **Branch:** mania-difficulty
- **SHA:** `e6207616bd732c7c00207a060f31cf7729f8390b`
- **Checkout:** `MANIA_DIFFICULTY_UPSTREAM` or `.cache/upstream` (via `bun run upstream:pin`)
- **Report command:** `bun run port:report`

## Summary

| Class | Count | Action |
|---|---|---|
| generate | 64 | Roslyn → `generated/` |
| shim | 19 | Handwritten `src/adapters/` + minimal types |
| out-of-scope | 14 | Skip (PP, drawables, legacy) |

## Entry point

- `osu.Game.Rulesets.Mania.Difficulty.ManiaDifficultyCalculator`
- Skills: Speed, Technical, Jack, Coordination, Release, Total×2
- Attributes: `ManiaDifficultyAttributes` (starRating, skill difficulties, LN ratio, hit window, score-loss coeffs, …)

## v1 scope

- Difficulty (SR + attributes) only — **no** performance/PP.
- Native mania beatmaps; converts deferred.
- Mods: NM + rate (DT/HT/NC/DC) + EZ/HR hit-window scaling.

## generate

- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/AnchorEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/FullChordJackEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/JackSpacingEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/SpeedjackEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/JackEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/ReleaseEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/SpeedEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Evaluators/TechnicalEvaluator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/ManiaDifficultyAttributes.cs`
- `osu.Game.Rulesets.Mania/Difficulty/ManiaDifficultyCalculator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/ManiaDifficultyHitObject.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/ManiaMapData.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/ManiaPatternContextPreprocessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/CrossHandMashDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/EnduranceDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/JumptrillDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/ManipulationDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/MashDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/RollDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/RowManipulationDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/Detectors/VibroDetector.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/ManiaChain.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/ManiaHand.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/ManiaRow.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Preprocessing/Patterning/RowRange.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Processing/CoordinationProcessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Processing/IDifficultyProcessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Processing/IReadonlyDifficultyProcessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Processing/JackProcessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Processing/ReleaseProcessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Processing/SpeedProcessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Processing/TechnicalProcessor.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Skills/Coordination.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Skills/Jack.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Skills/ManiaSkill.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Skills/Release.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Skills/Speed.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Skills/Technical.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Skills/Total.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/AccuracyDifficulties.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/AccuracyValueMultipliers.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/ChordUtils.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnPatternUtils.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnRunUtils.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/CrossColumnUtils.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/DifficultyBinning.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/PolynomialPenaltyUtils.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/RootFinding.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/RunDampenUtils.cs`
- `osu.Game.Rulesets.Mania/Difficulty/Utils/TrillUtils.cs`
- `osu.Game/Rulesets/Difficulty/DifficultyAttributes.cs`
- `osu.Game/Rulesets/Difficulty/DifficultyCalculator.cs`
- `osu.Game/Rulesets/Difficulty/Preprocessing/DifficultyHitObject.cs`
- `osu.Game/Rulesets/Difficulty/RulesetBeatmapAttribute.cs`
- `osu.Game/Rulesets/Difficulty/Skills/HarmonicSkill.cs`
- `osu.Game/Rulesets/Difficulty/Skills/Skill.cs`
- `osu.Game/Rulesets/Difficulty/Skills/StrainDecaySkill.cs`
- `osu.Game/Rulesets/Difficulty/Skills/StrainSkill.cs`
- `osu.Game/Rulesets/Difficulty/Skills/VariableLengthStrainSkill.cs`
- `osu.Game/Rulesets/Difficulty/TimedDifficultyAttributes.cs`
- `osu.Game/Rulesets/Difficulty/Utils/DiffUtils.cs`
- `osu.Game/Rulesets/Difficulty/Utils/DiffUtils_Polynomial.cs`
- `osu.Game/Rulesets/Difficulty/Utils/ReverseQueue.cs`

## shim (handwritten / adapters)

- `osu.Game.Rulesets.Mania/Beatmaps/ManiaBeatmap.cs`
- `osu.Game.Rulesets.Mania/Beatmaps/ManiaBeatmapConverter.cs`
- `osu.Game.Rulesets.Mania/Mods/ManiaModDaycore.cs`
- `osu.Game.Rulesets.Mania/Mods/ManiaModDoubleTime.cs`
- `osu.Game.Rulesets.Mania/Mods/ManiaModEasy.cs`
- `osu.Game.Rulesets.Mania/Mods/ManiaModHalfTime.cs`
- `osu.Game.Rulesets.Mania/Mods/ManiaModHardRock.cs`
- `osu.Game.Rulesets.Mania/Mods/ManiaModNightcore.cs`
- `osu.Game.Rulesets.Mania/Objects/BarLine.cs`
- `osu.Game.Rulesets.Mania/Objects/HeadNote.cs`
- `osu.Game.Rulesets.Mania/Objects/HoldNote.cs`
- `osu.Game.Rulesets.Mania/Objects/HoldNoteBody.cs`
- `osu.Game.Rulesets.Mania/Objects/ManiaHitObject.cs`
- `osu.Game.Rulesets.Mania/Objects/Note.cs`
- `osu.Game.Rulesets.Mania/Objects/TailNote.cs`
- `osu.Game.Rulesets.Mania/Scoring/ManiaHealthProcessor.cs`
- `osu.Game.Rulesets.Mania/Scoring/ManiaHitWindows.cs`
- `osu.Game.Rulesets.Mania/Scoring/ManiaScoreMultiplierCalculator.cs`
- `osu.Game.Rulesets.Mania/Scoring/ManiaScoreProcessor.cs`

## out-of-scope

- `osu.Game.Rulesets.Mania/Difficulty/ManiaLegacyScoreSimulator.cs`
- `osu.Game.Rulesets.Mania/Difficulty/ManiaPerformanceAttributes.cs`
- `osu.Game.Rulesets.Mania/Difficulty/ManiaPerformanceCalculator.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableBarLine.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableHoldNote.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableHoldNoteBody.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableHoldNoteHead.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableHoldNoteTail.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableManiaHitObject.cs`
- `osu.Game.Rulesets.Mania/Objects/Drawables/DrawableNote.cs`
- `osu.Game/Rulesets/Difficulty/PerformanceAttributes.cs`
- `osu.Game/Rulesets/Difficulty/PerformanceBreakdown.cs`
- `osu.Game/Rulesets/Difficulty/PerformanceCalculator.cs`
- `osu.Game/Rulesets/Difficulty/PerformanceDisplayAttribute.cs`

## Construct notes (Phase 3+)

| Construct | Prevalence | Strategy |
|---|---|---|
| arithmetic / Math | high | direct |
| LINQ (Min/Max/Sum/Any/…) | medium | emit or shim helpers |
| List/arrays | high | number[] / Array |
| structs (value copy) | low–med | clone helpers |
| ref/out | polynomial utils | fail or rewrite |
| osu.Framework.Precision | polynomial | `src/adapters/math.ts` |
| full beatmap decoder | N/A | `@roxysu/osu-chart` → ManiaBeatmapInput |

