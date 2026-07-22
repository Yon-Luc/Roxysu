// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See the LICENCE file in the repository root for full licence text.

using osu.Game.Rulesets.Difficulty.Preprocessing;
using osu.Game.Rulesets.Mania.Difficulty.Processing;
using osu.Game.Rulesets.Mania.Difficulty.Utils;
using osu.Game.Rulesets.Mods;

namespace osu.Game.Rulesets.Mania.Difficulty.Skills
{
    /// <summary>
    /// This skill is processed last, to ensure that the rest of the skills are able to process the current note in each <see cref="IReadonlyDifficultyProcessor"/>.
    /// </summary>
    public class Total : ManiaSkill
    {
        private readonly IReadonlyDifficultyProcessor coordinationProcessor;
        private readonly IReadonlyDifficultyProcessor jackProcessor;
        private readonly IReadonlyDifficultyProcessor releaseProcessor;
        private readonly IReadonlyDifficultyProcessor speedProcessor;
        private readonly IReadonlyDifficultyProcessor technicalProcessor;

        private readonly bool includeReleases;

        public Total(Mod[] mods, bool includeReleases,
                     IReadonlyDifficultyProcessor coordinationProcessor,
                     IReadonlyDifficultyProcessor jackProcessor,
                     IReadonlyDifficultyProcessor releaseProcessor,
                     IReadonlyDifficultyProcessor speedProcessor,
                     IReadonlyDifficultyProcessor technicalProcessor)
            : base(mods)
        {
            this.includeReleases = includeReleases;
            this.coordinationProcessor = coordinationProcessor;
            this.jackProcessor = jackProcessor;
            this.releaseProcessor = releaseProcessor;
            this.speedProcessor = speedProcessor;
            this.technicalProcessor = technicalProcessor;
        }

        protected override double GetNoteWeight(DifficultyHitObject current)
        {
            return includeReleases ? base.GetNoteWeight(current) : 1.0;
        }

        protected override AccuracyDifficulties AccuracyDifficultiesAt(DifficultyHitObject current)
        {
            AccuracyDifficulties coordinationDifficulties = coordinationProcessor.TransformStrainToAccuracyDifficulties(coordinationProcessor.CurrentStrain);
            AccuracyDifficulties releaseDifficulty = releaseProcessor.TransformStrainToAccuracyDifficulties(includeReleases ? releaseProcessor.CurrentStrain : 0);
            AccuracyDifficulties speedDifficulty = speedProcessor.TransformStrainToAccuracyDifficulties(speedProcessor.CurrentStrain);
            AccuracyDifficulties jackDifficulty = jackProcessor.TransformStrainToAccuracyDifficulties(jackProcessor.CurrentStrain);
            AccuracyDifficulties technicalDifficulty = technicalProcessor.TransformStrainToAccuracyDifficulties(technicalProcessor.CurrentStrain);

            return combinedDifficulty(coordinationDifficulties, releaseDifficulty, speedDifficulty, jackDifficulty, technicalDifficulty);
        }

        private AccuracyDifficulties combinedDifficulty(AccuracyDifficulties coordinationDifficulty, AccuracyDifficulties releaseDifficulty, AccuracyDifficulties speedDifficulty, AccuracyDifficulties jackDifficulty, AccuracyDifficulties technicalDifficulty)
        {
            const int combine_lambda = 2;

            AccuracyDifficulties powerSum = AccuracyDifficulties.Pow(speedDifficulty, combine_lambda)
                                            + AccuracyDifficulties.Pow(jackDifficulty, combine_lambda)
                                            + AccuracyDifficulties.Pow(coordinationDifficulty, combine_lambda)
                                            + AccuracyDifficulties.Pow(technicalDifficulty, combine_lambda);

            AccuracyDifficulties tapDifficulty = powerSum.BaseDifficulty > 0 ? AccuracyDifficulties.Pow(powerSum, 1.0 / combine_lambda) : powerSum;
            return tapDifficulty + releaseDifficulty;
        }
    }
}
