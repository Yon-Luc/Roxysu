// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See the LICENCE file in the repository root for full licence text.

using System;
using System.Collections.Generic;
using System.Linq;
using osu.Game.Beatmaps;
using osu.Game.Extensions;
using osu.Game.Rulesets.Difficulty;
using osu.Game.Rulesets.Difficulty.Preprocessing;
using osu.Game.Rulesets.Difficulty.Skills;
using osu.Game.Rulesets.Difficulty.Utils;
using osu.Game.Rulesets.Mania.Beatmaps;
using osu.Game.Rulesets.Mania.Difficulty.Preprocessing;
using osu.Game.Rulesets.Mania.Difficulty.Processing;
using osu.Game.Rulesets.Mania.Difficulty.Skills;
using osu.Game.Rulesets.Mania.Difficulty.Utils;
using osu.Game.Rulesets.Mania.Mods;
using osu.Game.Rulesets.Mania.Objects;
using osu.Game.Rulesets.Mania.Scoring;
using osu.Game.Rulesets.Mods;
using osu.Game.Rulesets.Objects;
using osu.Game.Rulesets.Scoring;
using osu.Game.Utils;

namespace osu.Game.Rulesets.Mania.Difficulty
{
    public class ManiaDifficultyCalculator : DifficultyCalculator
    {
        public const double STAR_RATING_EXPONENT = 0.52899;

        private const double overall_multiplier = 0.360643;

        /// SR *= (1 - full_ln_damper * lnRatio^2).
        private const double full_ln_damper = 0.06263;

        private const double ln_hybrid_damper = 0.028;
        private const double ln_hybrid_ramp_lo = 0.15;
        private const double ln_hybrid_ramp_hi = 0.35;
        private const double ln_hybrid_fade_lo = 0.50;
        private const double ln_hybrid_fade_hi = 0.75;

        private const double short_map_nerf = 0.195;
        private const double short_map_cap_notes = 197.0;
        private const double short_map_sustain_lo = 250.0;
        private const double short_map_sustain_hi = 450.0;

        private const double spike_damper_strength = 0.118;
        private const double spike_sustain_ratio_lo = 0.24;
        private const double spike_sustain_ratio_hi = 0.50;

        private const double high_end_compression_knee = 11.5;
        private const double high_end_compression_strength = 0.5;

        private const double high_end_coordination_gate_lo = 7.40522;
        private const double high_end_coordination_gate_hi = 11.65637;

        private const double od_weight = 0.188;

        private readonly bool isForCurrentRuleset;

        public override int Version => 20241007;

        public ManiaDifficultyCalculator(IRulesetInfo ruleset, IWorkingBeatmap beatmap)
            : base(ruleset, beatmap)
        {
            isForCurrentRuleset = beatmap.BeatmapInfo.Ruleset.MatchesOnlineID(ruleset);
        }

        protected override DifficultyAttributes CreateDifficultyAttributes(IBeatmap beatmap, Mod[] mods, Skill[] skills)
        {
            if (beatmap.HitObjects.Count == 0)
                return new ManiaDifficultyAttributes { Mods = mods };

            var totalSkill = skills.OfType<Total>().First();
            var totalSkillNoReleases = skills.OfType<Total>().Last();
            var speedSkill = skills.OfType<Speed>().Single();
            var technicalSkill = skills.OfType<Technical>().Single();
            var jackSkill = skills.OfType<Jack>().Single();
            var coordinationSkill = skills.OfType<Coordination>().Single();
            var releaseSkill = skills.OfType<Release>().Single();

            HitWindows hitWindows = new ManiaHitWindows();
            hitWindows.SetDifficulty(beatmap.Difficulty.OverallDifficulty);

            // Hard rock and ez don't apply directly to od, so we manually scale the hit windows.
            double windowScale = 1.0;
            if (mods.Any(m => m is ManiaModHardRock))
                windowScale = 1.0 / ManiaModHardRock.HIT_WINDOW_DIFFICULTY_MULTIPLIER;
            else if (mods.Any(m => m is ManiaModEasy))
                windowScale = 1.0 / ManiaModEasy.HIT_WINDOW_DIFFICULTY_MULTIPLIER;

            double greatHitWindow = hitWindows.WindowFor(HitResult.Great) * windowScale;
            double odMult = hitWindowMultiplier(greatHitWindow);

            int totalNotes = beatmap.HitObjects.Count;
            int holdNotes = beatmap.HitObjects.Count(h => h is HoldNote);

            double lnRatio = totalNotes > 0 ? (double)holdNotes / totalNotes : 0.0;
            double hybridLn = DiffUtils.Smoothstep(lnRatio, ln_hybrid_ramp_lo, ln_hybrid_ramp_hi) * (1.0 - DiffUtils.Smoothstep(lnRatio, ln_hybrid_fade_lo, ln_hybrid_fade_hi));
            double lnDamper = (1.0 - full_ln_damper * lnRatio * lnRatio) * (1.0 - ln_hybrid_damper * hybridLn);

            int columns = ((ManiaBeatmap)Beatmap).TotalColumns;
            double meanHoldMs = holdNotes > 0 ? beatmap.HitObjects.OfType<HoldNote>().Average(h => h.Duration) : 0.0;
            double shortMapMult = shortMapNerf(totalNotes, columns, meanHoldMs);
            double spikeMult = spikeNerf(totalSkill.SustainRatio());

            double totalDifficulty = totalSkill.DifficultyValue();
            double ssSkill = totalSkill.DifficultyValueAtAccuracy(1.0);
            double totalDifficultyNoReleases = totalSkillNoReleases.DifficultyValue();
            double lnKeyedMult = monotonicLnMultiplier(lnDamper, totalDifficulty, totalDifficultyNoReleases);

            double speedStarRating = scaleToStarRating(speedSkill.DifficultyValue()) * odMult;
            double technicalStarRating = scaleToStarRating(technicalSkill.DifficultyValue()) * odMult;
            double jackStarRating = scaleToStarRating(jackSkill.DifficultyValue()) * odMult;
            double coordinationStarRating = scaleToStarRating(coordinationSkill.DifficultyValue()) * odMult;
            double releaseStarRating = scaleToStarRating(releaseSkill.DifficultyValue()) * odMult;

            double starRating = computeStarRating(totalDifficulty, odMult, lnKeyedMult, spikeMult * shortMapMult, coordinationStarRating);
            double starRatingSS = computeStarRating(ssSkill, odMult, lnKeyedMult, spikeMult * shortMapMult, coordinationStarRating);

            PolynomialPenaltyUtils.QuarticCoefficients scoreLossCoefficients = totalSkill.GetScoreLossCoefficients(ssSkill);

            return new ManiaDifficultyAttributes
            {
                StarRating = starRating,
                StarRatingSS = starRatingSS,
                ScoreLossCoefficientA = scoreLossCoefficients.A,
                ScoreLossCoefficientB = scoreLossCoefficients.B,
                ScoreLossCoefficientC = scoreLossCoefficients.C,
                ScoreLossCoefficientD = scoreLossCoefficients.D,
                Mods = mods,
                MaxCombo = beatmap.HitObjects.Sum(maxComboForObject),
                SpeedDifficulty = speedStarRating,
                TechnicalDifficulty = technicalStarRating,
                JackDifficulty = jackStarRating,
                CoordinationDifficulty = coordinationStarRating,
                ReleaseDifficulty = releaseStarRating,
                Variety = participationRatio(speedStarRating, technicalStarRating, jackStarRating, coordinationStarRating, releaseStarRating),
                LnRatio = lnRatio,
                GreatHitWindow = greatHitWindow,
                MeanManipulation = meanManipulation,
                NoteCount = totalNotes,
                HoldNoteCount = holdNotes,
                OverallDifficulty = beatmap.Difficulty.OverallDifficulty
            };
        }

        private static double participationRatio(params double[] difficulties)
        {
            double sum = 0;
            double sumSquares = 0;

            foreach (double d in difficulties)
            {
                sum += d;
                sumSquares += d * d;
            }

            return sumSquares > 0 ? sum * sum / sumSquares : 1.0;
        }

        private static double shortMapNerf(int totalNotes, int columns, double meanHoldMs)
        {
            double perColumnNotes = columns > 0 ? (double)totalNotes / columns : totalNotes;
            double shortness = 1.0 - Math.Clamp(perColumnNotes / short_map_cap_notes, 0.0, 1.0);

            double sustainProtection = DiffUtils.Smoothstep(meanHoldMs, short_map_sustain_lo, short_map_sustain_hi);
            shortness *= 1.0 - sustainProtection;

            return 1.0 - short_map_nerf * shortness;
        }

        private static double spikeNerf(double sustainRatio)
        {
            double sustain = DiffUtils.Smoothstep(sustainRatio, spike_sustain_ratio_lo, spike_sustain_ratio_hi);
            return 1.0 - spike_damper_strength * (1.0 - sustain);
        }

        private static double computeStarRating(double totalDifficulty, double overallDifficultyMultiplier, double longNoteDamper, double shortMapMultiplier, double coordinationDifficulty)
        {
            double starRating = scaleToStarRating(totalDifficulty)
                                * overallDifficultyMultiplier
                                * longNoteDamper
                                * shortMapMultiplier;
            //
            // if (starRating > high_end_compression_knee)
            // {
            //     double coordinationGate = DiffUtils.Smoothstep(coordinationDifficulty, high_end_coordination_gate_lo, high_end_coordination_gate_hi);
            //     double excessAboveKnee = starRating - high_end_compression_knee;
            //     starRating = high_end_compression_knee + excessAboveKnee * (1.0 - high_end_compression_strength * coordinationGate);
            // }

            return starRating;
        }

        private static double monotonicLnMultiplier(double lnKeyedMultiplier, double totalDifficulty, double tapOnlyDifficulty)
        {
            double lnKeyedNerf = 1.0 - lnKeyedMultiplier;

            if (lnKeyedNerf <= 0.0)
                return lnKeyedMultiplier;

            double fullStarRating = scaleToStarRating(totalDifficulty);

            if (fullStarRating <= 0.0)
                return lnKeyedMultiplier;

            double lnAddedFraction = Math.Max(0.0, 1.0 - scaleToStarRating(tapOnlyDifficulty) / fullStarRating);
            return 1.0 - Math.Min(lnKeyedNerf, lnAddedFraction);
        }

        private static double scaleToStarRating(double aggregatedDifficulty)
        {
            if (aggregatedDifficulty <= 0)
                return 0.0;

            return overall_multiplier * DiffUtils.Pow(aggregatedDifficulty, STAR_RATING_EXPONENT);
        }

        private static double hitLeniency(double greatHitWindow) => 0.6 * (greatHitWindow - 90) + 90;

        private double hitWindowMultiplier(double greatHitWindow)
        {
            const double od8_great_window = 40.0;

            // Our hit window multiplier is scaled around a base value of od8 (40ms)
            double raw = hitLeniency(od8_great_window) / hitLeniency(greatHitWindow);
            return 1.0 + od_weight * (raw - 1.0);
        }

        private int maxComboForObject(HitObject hitObject)
        {
            if (hitObject is HoldNote hold)
                return 1 + (int)((hold.EndTime - hold.StartTime) / 100);

            return 1;
        }

        protected override IEnumerable<DifficultyHitObject> CreateDifficultyHitObjects(IBeatmap beatmap, Mod[] mods)
        {
            var sortedObjects = beatmap.HitObjects.ToList();
            int totalColumns = ((ManiaBeatmap)beatmap).TotalColumns;

            double clockRate = ModUtils.CalculateRateWithMods(mods);

            sortedObjects.Sort(Comparer<HitObject>.Create((a, b) => (int)Math.Round(a.StartTime) - (int)Math.Round(b.StartTime)));

            List<DifficultyHitObject> objects = new List<DifficultyHitObject>(beatmap.HitObjects.Count);
            List<DifficultyHitObject>[] perColumnObjects = new List<DifficultyHitObject>[totalColumns];

            for (int column = 0; column < totalColumns; column++)
                perColumnObjects[column] = new List<DifficultyHitObject>();

            for (int i = 1; i < sortedObjects.Count; i++)
            {
                var currentObject = new ManiaDifficultyHitObject(sortedObjects[i], sortedObjects[i - 1], clockRate, objects, perColumnObjects, objects.Count);
                objects.Add(currentObject);
                perColumnObjects[currentObject.Column].Add(currentObject);
            }

            ManiaMapData mapData = new ManiaMapData(objects.Cast<ManiaDifficultyHitObject>().ToList());
            ManiaManipulationDifficultyPreprocessor.ProcessAndAssign(mapData, totalColumns);

            meanManipulation = objects.Count > 0
                ? objects.Cast<ManiaDifficultyHitObject>().Average(o => o.ManipulationFactor)
                : 1.0;

            return objects;
        }

        private double meanManipulation = 1.0;

        protected override IEnumerable<DifficultyHitObject> SortObjects(IEnumerable<DifficultyHitObject> input) => input;

        protected override Skill[] CreateSkills(IBeatmap beatmap, Mod[] mods)
        {
            SpeedProcessor speedProcessor = new SpeedProcessor();
            TechnicalProcessor technicalProcessor = new TechnicalProcessor();
            JackProcessor jackProcessor = new JackProcessor();
            CoordinationProcessor coordinationProcessor = new CoordinationProcessor();
            ReleaseProcessor releaseProcessor = new ReleaseProcessor();

            return new Skill[]
            {
                new Speed(mods, speedProcessor),
                new Technical(mods, technicalProcessor),
                new Jack(mods, jackProcessor),
                new Coordination(mods, coordinationProcessor),
                new Release(mods, releaseProcessor),
                new Total(mods, true, coordinationProcessor, jackProcessor, releaseProcessor, speedProcessor, technicalProcessor),
                new Total(mods, false, coordinationProcessor, jackProcessor, releaseProcessor, speedProcessor, technicalProcessor),
            };
        }

        protected override Mod[] DifficultyAdjustmentMods
        {
            get
            {
                var mods = new Mod[]
                {
                    new ManiaModDoubleTime(),
                    new ManiaModHalfTime(),
                    new ManiaModEasy(),
                    new ManiaModHardRock(),
                };

                if (isForCurrentRuleset)
                    return mods;

                return mods.Concat(new Mod[]
                {
                    new ManiaModKey1(),
                    new ManiaModKey2(),
                    new ManiaModKey3(),
                    new ManiaModKey4(),
                    new ManiaModKey5(),
                    new MultiMod(new ManiaModKey5(), new ManiaModDualStages()),
                    new ManiaModKey6(),
                    new MultiMod(new ManiaModKey6(), new ManiaModDualStages()),
                    new ManiaModKey7(),
                    new MultiMod(new ManiaModKey7(), new ManiaModDualStages()),
                    new ManiaModKey8(),
                    new MultiMod(new ManiaModKey8(), new ManiaModDualStages()),
                    new ManiaModKey9(),
                    new MultiMod(new ManiaModKey9(), new ManiaModDualStages()),
                }).ToArray();
            }
        }
    }
}
