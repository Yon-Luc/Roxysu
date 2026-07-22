// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See the LICENCE file in the repository root for full licence text.

using System;
using osu.Framework.Utils;

namespace osu.Game.Rulesets.Mania.Difficulty.Utils
{
    public class AccuracyDifficulties
    {
        private const int base_index = 2; // Hacky - the difficulty at 98%.

        public double BaseDifficulty { get; }
        public double[] Multipliers { get; }

        public AccuracyDifficulties()
        {
            BaseDifficulty = 0;
            Multipliers = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];
        }

        public AccuracyDifficulties(double difficulty, AccuracyValueMultipliers multipliers)
        {
            BaseDifficulty = difficulty;
            Multipliers = multipliers.AccuracyMultipliers;
        }

        private AccuracyDifficulties(double baseDifficulty, double[] multipliers)
        {
            BaseDifficulty = baseDifficulty;
            Multipliers = multipliers;
        }

        /// <summary>
        /// Reconstructs the absolute difficulty value at a given accuracy index from
        /// <see cref="BaseDifficulty"/> and <see cref="Multipliers"/>.
        /// </summary>
        private double getDifficulty(int index) => BaseDifficulty * Multipliers[index];

        /// <summary>
        /// Builds an <see cref="AccuracyDifficulties"/> from a full array of absolute difficulty
        /// values, decomposing it back into a base difficulty and relative multipliers.
        /// </summary>
        private static AccuracyDifficulties fromDifficultyArray(double[] difficulties)
        {
            double baseDifficulty = difficulties[base_index];
            double[] multipliers = new double[difficulties.Length];

            for (int i = 0; i < difficulties.Length; i++)
                multipliers[i] = baseDifficulty != 0 ? difficulties[i] / baseDifficulty : 0;

            return new AccuracyDifficulties(baseDifficulty, multipliers);
        }

        public static AccuracyDifficulties Pow(AccuracyDifficulties difficultiesBase, double exponent)
        {
            double[] newDifficulties = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];

            for (int i = 0; i < AccuracyValueMultipliers.ACCURACY_VALUES.Length; i++)
                newDifficulties[i] = Math.Pow(difficultiesBase.getDifficulty(i), exponent);

            return fromDifficultyArray(newDifficulties);
        }

        public static AccuracyDifficulties Norm(double exponent, params AccuracyDifficulties[] normedDifficulties)
        {
            AccuracyDifficulties newDifficulties = new AccuracyDifficulties();

            for (int i = 0; i < normedDifficulties.Length; i++)
            {
                newDifficulties += Pow(normedDifficulties[i], exponent);
            }

            newDifficulties = Pow(newDifficulties, 1 / exponent);

            return newDifficulties;
        }

        public static AccuracyDifficulties operator +(AccuracyDifficulties left, AccuracyDifficulties right)
        {
            double[] newDifficulties = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];

            for (int i = 0; i < AccuracyValueMultipliers.ACCURACY_VALUES.Length; i++)
                newDifficulties[i] = left.getDifficulty(i) + right.getDifficulty(i);

            return fromDifficultyArray(newDifficulties);
        }

        public static AccuracyDifficulties operator +(AccuracyDifficulties left, double right)
        {
            double[] newDifficulties = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];

            for (int i = 0; i < AccuracyValueMultipliers.ACCURACY_VALUES.Length; i++)
                newDifficulties[i] = left.getDifficulty(i) + right;

            return fromDifficultyArray(newDifficulties);
        }

        public static AccuracyDifficulties operator -(AccuracyDifficulties left, AccuracyDifficulties right)
        {
            double[] newDifficulties = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];

            for (int i = 0; i < AccuracyValueMultipliers.ACCURACY_VALUES.Length; i++)
                newDifficulties[i] = left.getDifficulty(i) - right.getDifficulty(i);

            return fromDifficultyArray(newDifficulties);
        }

        public static AccuracyDifficulties operator *(AccuracyDifficulties left, AccuracyDifficulties right)
        {
            double[] newDifficulties = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];

            for (int i = 0; i < AccuracyValueMultipliers.ACCURACY_VALUES.Length; i++)
                newDifficulties[i] = left.getDifficulty(i) * right.getDifficulty(i);

            return fromDifficultyArray(newDifficulties);
        }

        public static AccuracyDifficulties operator *(AccuracyDifficulties left, double right)
        {
            double[] newDifficulties = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];

            for (int i = 0; i < AccuracyValueMultipliers.ACCURACY_VALUES.Length; i++)
                newDifficulties[i] = left.getDifficulty(i) * right;

            return fromDifficultyArray(newDifficulties);
        }

        public static AccuracyDifficulties operator /(AccuracyDifficulties left, AccuracyDifficulties right)
        {
            double[] newDifficulties = new double[AccuracyValueMultipliers.ACCURACY_VALUES.Length];

            for (int i = 0; i < AccuracyValueMultipliers.ACCURACY_VALUES.Length; i++)
                newDifficulties[i] = left.getDifficulty(i) / right.getDifficulty(i);

            return fromDifficultyArray(newDifficulties);
        }

        public double AccuracyAt(double skill)
        {
            if (skill >= getDifficulty(0))
                return AccuracyValueMultipliers.ACCURACY_VALUES[0];
            if (skill <= 0)
                return AccuracyValueMultipliers.ACCURACY_VALUES[^1];

            for (int i = 1; i < Multipliers.Length; i++)
            {
                if (getDifficulty(i) > skill)
                    continue;

                double upperSkillBound = getDifficulty(i - 1);
                double lowerSkillBound = getDifficulty(i);

                double upperAccuracyBound = AccuracyValueMultipliers.ACCURACY_VALUES[i - 1];
                double lowerAccuracyBound = AccuracyValueMultipliers.ACCURACY_VALUES[i];

                return Interpolation.Lerp(lowerAccuracyBound, upperAccuracyBound, (skill - lowerSkillBound) / (upperSkillBound - lowerSkillBound));
            }

            return 0;
        }

        public double DifficultyAt(double accuracy)
        {
            if (accuracy >= AccuracyValueMultipliers.ACCURACY_VALUES[0])
                return getDifficulty(0);
            if (accuracy <= AccuracyValueMultipliers.ACCURACY_VALUES[^1])
                return getDifficulty(Multipliers.Length - 1);

            for (int i = 1; i < Multipliers.Length; i++)
            {
                if (AccuracyValueMultipliers.ACCURACY_VALUES[i] > accuracy)
                    continue;

                double upperSkillBound = getDifficulty(i - 1);
                double lowerSkillBound = getDifficulty(i);

                double upperAccuracyBound = AccuracyValueMultipliers.ACCURACY_VALUES[i - 1];
                double lowerAccuracyBound = AccuracyValueMultipliers.ACCURACY_VALUES[i];

                return Interpolation.Lerp(lowerSkillBound, upperSkillBound, (accuracy - lowerAccuracyBound) / (upperAccuracyBound - lowerAccuracyBound));
            }

            return 0;
        }
    }
}
