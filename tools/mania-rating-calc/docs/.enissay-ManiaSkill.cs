// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See the LICENCE file in the repository root for full licence text.

using System;
using System.Collections.Generic;
using System.Linq;
using osu.Game.Rulesets.Difficulty.Preprocessing;
using osu.Game.Rulesets.Difficulty.Skills;
using osu.Game.Rulesets.Difficulty.Utils;
using osu.Game.Rulesets.Mania.Difficulty.Utils;
using osu.Game.Rulesets.Mania.Objects;
using osu.Game.Rulesets.Mods;

namespace osu.Game.Rulesets.Mania.Difficulty.Skills
{
    public abstract class ManiaSkill : Skill
    {
        private double totalNoteWeight;

        private readonly List<double> sortedDifficulties;
        private readonly List<AccuracyDifficulties> accuracyDifficulties;

        protected int BaseNoteCount { get; private set; }

        private readonly BinnedDifficulties binnedDifficulties = new BinnedDifficulties();

        protected ManiaSkill(Mod[] mods)
            : base(mods)
        {
            sortedDifficulties = new List<double>();
            accuracyDifficulties = new List<AccuracyDifficulties>();
        }

        protected override double ProcessInternal(DifficultyHitObject current)
        {
            BaseNoteCount++;
            totalNoteWeight += GetNoteWeight(current);

            AccuracyDifficulties difficulties = AccuracyDifficultiesAt(current);

            if (difficulties.BaseDifficulty > 0)
            {
                sortedDifficulties.Add(difficulties.BaseDifficulty);
            }

            accuracyDifficulties.Add(difficulties);

            // Invalidate our current bins, we need to remake them.
            binnedDifficulties.Add(difficulties);

            return difficulties.BaseDifficulty;
        }

        protected virtual double GetNoteWeight(DifficultyHitObject current)
        {
            const double max_long_note_weight_duration_ms = 1000.0;
            const double long_note_weight_per_200_ms = 0.6;

            double noteWeight = 1;

            // Add additional weight for hold notes, depending on their length.
            if (current.BaseObject is HoldNote holdNote)
            {
                double duration = Math.Min(holdNote.EndTime - holdNote.StartTime, max_long_note_weight_duration_ms);
                noteWeight += long_note_weight_per_200_ms * duration / 200.0;
            }

            return noteWeight;
        }

        protected abstract AccuracyDifficulties AccuracyDifficultiesAt(DifficultyHitObject current);

        public double SustainRatio()
        {
            if (sortedDifficulties.Count == 0)
                return 1.0;

            sortedDifficulties.Sort();

            double median = strainAtPercentile(0.50);
            double high = strainAtPercentile(0.90);

            return high > 0 ? median / high : 1.0;
        }

        private double strainAtPercentile(double percentile)
        {
            int maxIndex = sortedDifficulties.Count - 1;
            int index = Math.Clamp((int)Math.Round(maxIndex * percentile), 0, maxIndex);
            return sortedDifficulties[index];
        }

        public double DifficultyValueAtAccuracy(double accuracy)
        {
            if (accuracyDifficulties.Count == 0 || accuracy <= 0.8)
                return 0;

            double baseDifficulty = RootFinding.FindRootExpand(skill => AccuracyAtSkill(skill) - accuracy, 0, 10);

            const double note_count_offset = 34.64147;

            return baseDifficulty * (totalNoteWeight / (totalNoteWeight + note_count_offset));
        }

        public double AccuracyAtSkill(double skill)
        {
            if (skill == 0)
                return 0;

            return accuracyDifficulties.Count > 64 ? AccuracyAtSkillBinned(skill, binnedDifficulties.Bins) : AccuracyAtSkillExact(skill);
        }

        public double AccuracyAtSkillExact(double skill)
        {
            double accuracySum = 0;

            foreach (AccuracyDifficulties accuracy in accuracyDifficulties)
            {
                accuracySum += accuracy.AccuracyAt(skill);
            }

            // Return the accuracy value, but we subtract 1% of the notes from the divisor so that an SS isn't just the difficulty of the highest note.
            return accuracySum / (accuracyDifficulties.Count - Math.Min(accuracyDifficulties.Count * 0.01, 10));
        }

        public double AccuracyAtSkillBinned(double skill, Bin[] binnedAccuracies)
        {
            double accuracySum = 0;

            foreach (Bin accuracyBin in binnedAccuracies)
            {
                accuracySum += accuracyBin.AccuracyAt(skill) * accuracyBin.Count;
            }

            // Return the accuracy value, but we subtract 1% of the notes from the divisor so that an SS isn't just the difficulty of the highest note.
            double result = accuracySum / (accuracyDifficulties.Count - Math.Min(accuracyDifficulties.Count * 0.01, 10));

            return result;
        }

        public override double DifficultyValue() => DifficultyValueAtAccuracy(0.96);

        /// <summary>
        /// The coefficients of a quartic fitted to the miss counts at each skill level.
        /// </summary>
        /// <returns>The coefficients for our penalty polynomial.</returns>
        public PolynomialPenaltyUtils.QuarticCoefficients GetScoreLossCoefficients(double ssSkill)
        {
            Dictionary<double, double> scoreLosses = new Dictionary<double, double>();

            // If there are no notes, we just return a zero-polynomial.
            if (ObjectDifficulties.Count == 0 || ObjectDifficulties.Max() == 0)
                return new PolynomialPenaltyUtils.QuarticCoefficients();

            foreach (double skillProportion in PolynomialPenaltyUtils.SKILL_PROPORTIONS)
            {
                if (skillProportion == 1)
                {
                    scoreLosses[skillProportion] = 0;
                    continue;
                }

                double penalizedSkill = ssSkill * skillProportion;

                // We take the log to squash miss counts, which have large absolute value differences, but low relative differences, into a straighter line for the polynomial.
                scoreLosses[skillProportion] = Math.Log((1.0 - AccuracyAtSkillExact(penalizedSkill)) + 1);
            }

            return PolynomialPenaltyUtils.GetPenaltyCoefficients(scoreLosses);
        }

        /// <summary>
        /// Calculates the mean of specific percentile values from a sorted array.
        /// </summary>
        /// <param name="sortedValues">Array of difficulty values, sorted ascending.</param>
        /// <param name="percentiles">Array of percentile positions (0.0 to 1.0).</param>
        private static double calculatePercentileMean(List<double> sortedValues, double[] percentiles)
        {
            int maxIndex = sortedValues.Count - 1;
            double sum = 0.0;

            foreach (double percentile in percentiles)
            {
                int index = Math.Clamp((int)Math.Round(maxIndex * percentile), 0, maxIndex);
                sum += sortedValues[index];
            }

            return sum / percentiles.Length;
        }

        private static double calculatePowerMean(List<double> values, int exponent)
        {
            double sum = values.Sum(value => DiffUtils.Pow(value, exponent));
            return DiffUtils.Pow(sum / values.Count, 1.0 / exponent);
        }
    }
}
