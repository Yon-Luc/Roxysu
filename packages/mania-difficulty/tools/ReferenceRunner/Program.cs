// Difficulty-only reference runner for @roxysu/mania-difficulty parity.
// Build: OSU_GAME_PATH=/path/to/osu@sha dotnet run --project tools/ReferenceRunner -- map.osu

using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using osu.Game.Beatmaps;
using osu.Game.Rulesets;
using osu.Game.Rulesets.Mania;
using osu.Game.Rulesets.Mania.Difficulty;
using osu.Game.Rulesets.Mods;

if (args.Length == 0 || args.Contains("-h") || args.Contains("--help"))
{
    Console.Error.WriteLine("Usage: mania-difficulty-ref [--mods NM] [--sha SHA] <path/to/map.osu>");
    Environment.Exit(args.Length == 0 ? 1 : 0);
}

string? sha = null;
var modsArg = "NM";
var beatmapPath = "";

for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--sha":
            sha = args[++i];
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

    var output = new RefOutput
    {
        Version = sha ?? "unknown",
        StarRating = maniaAttrs.StarRating,
        StarRatingSs = GetDouble(maniaAttrs, "StarRatingSS"),
        Attributes = BuildAttributes(maniaAttrs),
    };

    var json = JsonSerializer.Serialize(output, new JsonSerializerOptions
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
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
    Console.Error.WriteLine(JsonSerializer.Serialize(new { error = message }));
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

static Dictionary<string, object?> BuildAttributes(ManiaDifficultyAttributes attrs)
{
    var result = new Dictionary<string, object?>();

    void add(string key, object? value)
    {
        if (value is double d)
        {
            if (double.IsNaN(d)) return;
            result[key] = d;
            return;
        }

        if (value != null)
            result[key] = value;
    }

    add("speed_difficulty", GetDouble(attrs, "SpeedDifficulty"));
    add("technical_difficulty", GetDouble(attrs, "TechnicalDifficulty"));
    add("jack_difficulty", GetDouble(attrs, "JackDifficulty"));
    add("coordination_difficulty", GetDouble(attrs, "CoordinationDifficulty"));
    add("release_difficulty", GetDouble(attrs, "ReleaseDifficulty"));
    add("variety", GetDouble(attrs, "Variety"));
    add("ln_ratio", GetDouble(attrs, "LnRatio"));
    add("note_count", GetInt(attrs, "NoteCount"));
    add("hold_note_count", GetInt(attrs, "HoldNoteCount"));
    add("overall_difficulty", GetDouble(attrs, "OverallDifficulty"));
    add("great_hit_window", GetDouble(attrs, "GreatHitWindow"));
    add("mean_manip", GetDouble(attrs, "MeanManipulation"));
    add("score_loss_coefficient_a", GetDouble(attrs, "ScoreLossCoefficientA"));
    add("score_loss_coefficient_b", GetDouble(attrs, "ScoreLossCoefficientB"));
    add("score_loss_coefficient_c", GetDouble(attrs, "ScoreLossCoefficientC"));
    add("score_loss_coefficient_d", GetDouble(attrs, "ScoreLossCoefficientD"));

    return result;
}

static double? GetDouble(object obj, string name)
{
    var t = obj.GetType();
    var prop = t.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
    if (prop?.GetValue(obj) is double pd) return pd;
    var field = t.GetField(name, BindingFlags.Public | BindingFlags.Instance);
    if (field?.GetValue(obj) is double fd) return fd;
    return null;
}

static int? GetInt(object obj, string name)
{
    var t = obj.GetType();
    var prop = t.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
    if (prop?.GetValue(obj) is int pi) return pi;
    var field = t.GetField(name, BindingFlags.Public | BindingFlags.Instance);
    if (field?.GetValue(obj) is int fi) return fi;
    return null;
}

sealed class RefOutput
{
    public string Version { get; set; } = "";
    public double StarRating { get; set; }
    public double? StarRatingSs { get; set; }
    public Dictionary<string, object?>? Attributes { get; set; }
}
