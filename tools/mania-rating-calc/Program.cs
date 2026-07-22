// Mania SR + SS PP calculator CLI for Roxysu Rating Lab.
// Build from an osu!lazer checkout (see docs/mania-rating-lab.md).

using System.Text.Json;
using System.Text.Json.Serialization;
using osu.Game.Beatmaps;
using osu.Game.Rulesets;
using osu.Game.Rulesets.Mania;
using osu.Game.Rulesets.Mania.Difficulty;
using osu.Game.Rulesets.Mania.Objects;
using osu.Game.Rulesets.Mods;
using osu.Game.Rulesets.Scoring;
using osu.Game.Scoring;

if (args.Length == 0 || args.Contains("-h") || args.Contains("--help"))
{
    Console.Error.WriteLine("Usage: mania-rating-calc [--mods NM] [--version-id ID] <path/to/map.osu>");
    Environment.Exit(args.Length == 0 ? 1 : 0);
}

string? versionId = null;
var modsArg = "NM";
var beatmapPath = "";

for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--version-id":
            versionId = args[++i];
            break;
        case "--mods":
            modsArg = args[++i];
            break;
        default:
            if (!args[i].StartsWith('-'))
                beatmapPath = args[i];
            break;
    }
}

if (string.IsNullOrWhiteSpace(beatmapPath))
{
    Console.Error.WriteLine("Missing beatmap path.");
    Environment.Exit(1);
}

if (!File.Exists(beatmapPath))
{
    WriteError($"Beatmap not found: {beatmapPath}");
    Environment.Exit(1);
}

try
{
    var ruleset = new ManiaRuleset();
    var mods = ParseMods(ruleset, modsArg);

    var working = new FlatWorkingBeatmap(beatmapPath);

    var diffCalc = ruleset.CreateDifficultyCalculator(working);
    var diffAttrs = diffCalc.Calculate(mods);
    var maniaAttrs = (ManiaDifficultyAttributes)diffAttrs;

    var beatmap = working.GetPlayableBeatmap(ruleset.RulesetInfo, mods);
    var totalHits = CountTotalHits(beatmap);
    var maxCombo = beatmap.GetMaxCombo();
    var perfCalc = ruleset.CreatePerformanceCalculator();

    // Custom-accuracy tiers (%). Keys match Roxysu cache / UI (e.g. "99.5").
    double[] accuracyPercents = [100, 99.5, 97, 95, 93];

    var ppByAccuracy = new Dictionary<string, double>();
    ManiaPerformanceAttributes? ssPerf = null;
    double ppSs = 0;

    foreach (var percent in accuracyPercents)
    {
        var targetAcc = percent / 100.0;
        var stats = BuildStatisticsForCustomAccuracy(totalHits, targetAcc);
        var customAcc = CalculateCustomAccuracy(stats);

        var scoreInfo = new ScoreInfo
        {
            Ruleset = ruleset.RulesetInfo,
            Mods = mods,
            Statistics = stats,
            Accuracy = customAcc,
            MaxCombo = maxCombo,
        };

        var perfAttrs = perfCalc.Calculate(scoreInfo, diffAttrs);
        var key = FormatAccuracyKey(percent);
        ppByAccuracy[key] = perfAttrs.Total;

        if (percent >= 100.0 - 1e-9)
        {
            ppSs = perfAttrs.Total;
            ssPerf = perfAttrs as ManiaPerformanceAttributes;
        }
    }

    var output = new CalcOutput
    {
        Version = versionId ?? "unknown",
        StarRating = maniaAttrs.StarRating,
        StarRatingSs = GetStarRatingSs(maniaAttrs),
        PpSs = ppSs,
        PpByAccuracy = ppByAccuracy,
        Attributes = BuildAttributes(maniaAttrs, ssPerf),
    };

    var json = JsonSerializer.Serialize(output, new JsonSerializerOptions
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    });
    Console.WriteLine(json);
}
catch (Exception ex)
{
    WriteError(ex.ToString());
    Environment.Exit(1);
}

static string FormatAccuracyKey(double percent)
{
    // Stable string keys: 100, 99.5, 97, 95, 93
    if (Math.Abs(percent % 1) < 1e-9)
        return ((int)Math.Round(percent)).ToString();
    return percent.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);
}

static void WriteError(string message)
{
    var err = JsonSerializer.Serialize(new { error = message });
    Console.Error.WriteLine(err);
}

static Mod[] ParseMods(Ruleset ruleset, string modsArg)
{
    if (string.IsNullOrWhiteSpace(modsArg) || modsArg.Equals("NM", StringComparison.OrdinalIgnoreCase))
        return Array.Empty<Mod>();

    var mods = new List<Mod>();

    foreach (var token in modsArg.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    {
        var mod = ruleset.CreateModFromAcronym(token);
        if (mod == null)
            throw new ArgumentException($"Unknown mod: {token}");

        mods.Add(mod);
    }

    return mods.ToArray();
}

static int CountTotalHits(IBeatmap beatmap)
{
    int hits = 0;

    foreach (var obj in beatmap.HitObjects)
    {
        hits++;
        if (obj is HoldNote)
            hits++;
    }

    return hits;
}

/// <summary>
/// Synthesize judgement counts so mania custom accuracy ≈ <paramref name="targetAcc"/>.
/// Walks Perfect → Great → Good → Ok → Meh → Miss, converting just enough hits at each step.
/// </summary>
static Dictionary<HitResult, int> BuildStatisticsForCustomAccuracy(int totalHits, double targetAcc)
{
    (HitResult Result, double Weight)[] ladder =
    [
        (HitResult.Perfect, 320),
        (HitResult.Great, 300),
        (HitResult.Good, 200),
        (HitResult.Ok, 100),
        (HitResult.Meh, 50),
        (HitResult.Miss, 0),
    ];

    targetAcc = Math.Clamp(targetAcc, 0, 1);

    if (totalHits <= 0)
        return new Dictionary<HitResult, int> { [HitResult.Perfect] = 0 };

    if (targetAcc >= 1.0 - 1e-12)
        return new Dictionary<HitResult, int> { [HitResult.Perfect] = totalHits };

    // Start all Perfect, then demote counts down the ladder until custom acc matches target.
    var counts = new int[ladder.Length];
    counts[0] = totalHits;

    double maxWeight = ladder[0].Weight;
    double targetSum = targetAcc * totalHits * maxWeight;
    double currentSum = totalHits * maxWeight;

    for (var tier = 0; tier < ladder.Length - 1 && currentSum > targetSum + 1e-9; tier++)
    {
        var weightHere = ladder[tier].Weight;
        var weightNext = ladder[tier + 1].Weight;
        var dropPerHit = weightHere - weightNext;
        if (dropPerHit <= 0 || counts[tier] <= 0)
            continue;

        var needDrop = currentSum - targetSum;
        var convert = (int)Math.Min(counts[tier], Math.Ceiling(needDrop / dropPerHit - 1e-12));
        if (convert <= 0)
            continue;

        // Prefer the count that lands closest to target (floor vs ceil when both valid).
        var convertFloor = Math.Max(0, convert - 1);
        var sumFloor = currentSum - convertFloor * dropPerHit;
        var sumCeil = currentSum - convert * dropPerHit;
        if (convertFloor < convert &&
            Math.Abs(sumFloor - targetSum) <= Math.Abs(sumCeil - targetSum))
        {
            convert = convertFloor;
        }

        counts[tier] -= convert;
        counts[tier + 1] += convert;
        currentSum -= convert * dropPerHit;
    }

    var stats = new Dictionary<HitResult, int>();
    for (var i = 0; i < ladder.Length; i++)
    {
        if (counts[i] > 0)
            stats[ladder[i].Result] = counts[i];
    }

    if (stats.Count == 0)
        stats[HitResult.Miss] = totalHits;

    return stats;
}

static double CalculateCustomAccuracy(Dictionary<HitResult, int> stats)
{
    var perfect = stats.GetValueOrDefault(HitResult.Perfect);
    var great = stats.GetValueOrDefault(HitResult.Great);
    var good = stats.GetValueOrDefault(HitResult.Good);
    var ok = stats.GetValueOrDefault(HitResult.Ok);
    var meh = stats.GetValueOrDefault(HitResult.Meh);
    var miss = stats.GetValueOrDefault(HitResult.Miss);
    var totalHits = perfect + great + good + ok + meh + miss;
    if (totalHits == 0)
        return 0;

    return (perfect * 320.0 + great * 300.0 + good * 200.0 + ok * 100.0 + meh * 50.0)
           / (totalHits * 320.0);
}

static double? GetStarRatingSs(ManiaDifficultyAttributes attrs)
{
    var prop = attrs.GetType().GetProperty("StarRatingSS");
    if (prop?.GetValue(attrs) is double ssProp && ssProp > 0)
        return ssProp;

    var field = attrs.GetType().GetField("StarRatingSS");
    if (field?.GetValue(attrs) is double ssField && ssField > 0)
        return ssField;

    return null;
}

static Dictionary<string, object?> BuildAttributes(
    ManiaDifficultyAttributes attrs,
    ManiaPerformanceAttributes? perf)
{
    var result = new Dictionary<string, object?>();

    void add(string key, object? value)
    {
        if (value is double d && double.IsNaN(d)) return;
        if (value != null) result[key] = value;
    }

    add("speed_difficulty", TryGetDouble(attrs, "SpeedDifficulty"));
    add("technical_difficulty", TryGetDouble(attrs, "TechnicalDifficulty"));
    add("jack_difficulty", TryGetDouble(attrs, "JackDifficulty"));
    add("coordination_difficulty", TryGetDouble(attrs, "CoordinationDifficulty"));
    add("release_difficulty", TryGetDouble(attrs, "ReleaseDifficulty"));
    add("variety", TryGetDouble(attrs, "Variety"));
    add("ln_ratio", TryGetDouble(attrs, "LnRatio"));
    add("note_count", TryGetInt(attrs, "NoteCount"));
    add("hold_note_count", TryGetInt(attrs, "HoldNoteCount"));
    add("overall_difficulty", TryGetDouble(attrs, "OverallDifficulty"));
    add("great_hit_window", TryGetDouble(attrs, "GreatHitWindow"));
    add("score_loss_coefficient_a", TryGetDouble(attrs, "ScoreLossCoefficientA"));
    add("score_loss_coefficient_b", TryGetDouble(attrs, "ScoreLossCoefficientB"));
    add("score_loss_coefficient_c", TryGetDouble(attrs, "ScoreLossCoefficientC"));
    add("score_loss_coefficient_d", TryGetDouble(attrs, "ScoreLossCoefficientD"));

    if (perf != null)
    {
        add("difficulty", TryGetDouble(perf, "Difficulty"));
        add("ss_value", TryGetDouble(perf, "ValueSS"));
        add("accuracy_value", TryGetDouble(perf, "AccuracyValue"));
        add("difficulty_value", TryGetDouble(perf, "DifficultyValue"));
    }

    return result;
}

static double? TryGetDouble(object obj, string propName)
{
    var prop = obj.GetType().GetProperty(propName);
    if (prop?.GetValue(obj) is double d) return d;
    var field = obj.GetType().GetField(propName);
    if (field?.GetValue(obj) is double f) return f;
    return null;
}

static int? TryGetInt(object obj, string propName)
{
    var prop = obj.GetType().GetProperty(propName);
    if (prop?.GetValue(obj) is int i) return i;
    var field = obj.GetType().GetField(propName);
    if (field?.GetValue(obj) is int f) return f;
    return null;
}

sealed class CalcOutput
{
    public string Version { get; set; } = "";
    public double StarRating { get; set; }
    public double? StarRatingSs { get; set; }
    public double PpSs { get; set; }
    public Dictionary<string, double>? PpByAccuracy { get; set; }
    public Dictionary<string, object?>? Attributes { get; set; }
}
