// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See the LICENCE file in the repository root for full licence text.

namespace osu.Game.Rulesets.Mania.Difficulty.Utils
{
    public struct AccuracyValueMultipliers
    {
        public static readonly double[] ACCURACY_VALUES = { 1.00, 0.99, 0.98, 0.95, 0.90, 0.85, 0.80, 0.75 };

        public readonly double[] AccuracyMultipliers => new[]
        {
            MultiplierAtSS,
            MultiplierAt99,
            MultiplierAt98,
            MultiplierAt95,
            MultiplierAt90,
            MultiplierAt85,
            MultiplierAt80,
            0.0 // The multiplier at 75% is always 0.
        };

        public required double MultiplierAtSS;
        public required double MultiplierAt99;
        public required double MultiplierAt98;
        public required double MultiplierAt95;
        public required double MultiplierAt90;
        public required double MultiplierAt85;
        public required double MultiplierAt80;
    }
}
