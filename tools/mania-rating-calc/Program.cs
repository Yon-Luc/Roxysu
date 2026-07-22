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
    var perfectStats = BuildPerfectStatistics(beatmap);

    var scoreInfo = new ScoreInfo
    {
        Ruleset = ruleset.RulesetInfo,
        Mods = mods,
        Statistics = perfectStats,
        Accuracy = 1.0,
        MaxCombo = beatmap.GetMaxCombo(),
    };

    var perfCalc = ruleset.CreatePerformanceCalculator();
    var perfAttrs = perfCalc.Calculate(scoreInfo, diffAttrs);
    var maniaPerf = perfAttrs as ManiaPerformanceAttributes;

    var output = new CalcOutput
    {
        Version = versionId ?? "unknown",
        StarRating = maniaAttrs.StarRating,
        StarRatingSs = GetStarRatingSs(maniaAttrs),
        PpSs = perfAttrs.Total,
        Attributes = BuildAttributes(maniaAttrs, maniaPerf),
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

static Dictionary<HitResult, int> BuildPerfectStatistics(IBeatmap beatmap)
{
    var stats = new Dictionary<HitResult, int>();
    int perfect = 0;

    foreach (var obj in beatmap.HitObjects)
    {
        perfect++;
        if (obj is HoldNote)
            perfect++;
    }

    stats[HitResult.Perfect] = perfect;
    return stats;
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
    public Dictionary<string, object?>? Attributes { get; set; }
}
