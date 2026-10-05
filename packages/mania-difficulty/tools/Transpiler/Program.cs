using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using ManiaDifficulty.Transpiler;

var packageRoot = FindPackageRoot();
var revisionPath = Path.Combine(packageRoot, "upstream", "revision.json");
var configPath = Path.Combine(packageRoot, "tools", "upstream.config.json");
var generatedRoot = Path.Combine(packageRoot, "generated");

var revision = JsonSerializer.Deserialize<RevisionInfo>(
    File.ReadAllText(revisionPath),
    JsonOpts()) ?? throw new InvalidOperationException("Invalid revision.json");
var config = JsonSerializer.Deserialize<UpstreamConfig>(
    File.ReadAllText(configPath),
    JsonOpts()) ?? throw new InvalidOperationException("Invalid upstream.config.json");

var upstream = ResolveUpstream(packageRoot, config, revision);
Console.Error.WriteLine($"[transpiler] upstream={upstream}");
Console.Error.WriteLine($"[transpiler] sha={revision.Sha} generator={revision.GeneratorVersion}");

var roots = config.GenerateRoots.Count > 0
    ? config.GenerateRoots
    : ["osu.Game/Rulesets/Difficulty/Utils/DiffUtils.cs"];

var diagnostics = new List<string>();
var emitted = new List<EmittedFile>();

foreach (var relative in roots)
{
    var sourcePath = Path.Combine(upstream, relative.Replace('/', Path.DirectorySeparatorChar));
    if (!File.Exists(sourcePath))
    {
        diagnostics.Add($"ERROR: Missing source: {relative}");
        continue;
    }

    var errorsBefore = diagnostics.Count(d => d.StartsWith("ERROR:", StringComparison.Ordinal));
    var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(sourcePath), path: sourcePath);
    var root = tree.GetCompilationUnitRoot();
    var translator = new TypeScriptTranslator(relative, revision, diagnostics);
    var ts = translator.Translate(root);
    var errorsAfter = diagnostics.Count(d => d.StartsWith("ERROR:", StringComparison.Ordinal));
    if (errorsAfter > errorsBefore)
        continue;

    var outRel = relative.Replace('\\', '/');
    if (outRel.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
        outRel = outRel[..^3] + ".ts";

    var normalized = NormalizeNewlines(ts);
    emitted.Add(new EmittedFile(outRel, Sha256Hex(normalized), normalized));
    Console.Error.WriteLine($"[transpiler] prepared generated/{outRel}");
}

foreach (var d in diagnostics)
    Console.Error.WriteLine(d);

if (diagnostics.Any(d => d.StartsWith("ERROR:", StringComparison.Ordinal)))
{
    // Do not overwrite last good generated/ output or manifest on failure.
    Console.Error.WriteLine("[transpiler] failed with errors (generated/ left unchanged)");
    Environment.Exit(1);
}

foreach (var file in emitted)
{
    var outPath = Path.Combine(generatedRoot, file.Path.Replace('/', Path.DirectorySeparatorChar));
    Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
    File.WriteAllText(outPath, file.Content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    Console.Error.WriteLine($"[transpiler] wrote generated/{file.Path}");
}

WriteManifest(generatedRoot, revision, emitted);
Console.Error.WriteLine($"[transpiler] ok ({emitted.Count} file(s))");
return;

static string FindPackageRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir != null)
    {
        if (File.Exists(Path.Combine(dir.FullName, "package.json")) &&
            File.Exists(Path.Combine(dir.FullName, "upstream", "revision.json")))
            return dir.FullName;
        dir = dir.Parent;
    }

    var fromCwd = Directory.GetCurrentDirectory();
    foreach (var candidate in new[]
             {
                 fromCwd,
                 Directory.GetParent(fromCwd)?.FullName,
                 Directory.GetParent(fromCwd)?.Parent?.FullName,
             })
    {
        if (candidate != null &&
            File.Exists(Path.Combine(candidate, "package.json")) &&
            File.Exists(Path.Combine(candidate, "upstream", "revision.json")))
            return candidate;
    }

    throw new InvalidOperationException("Could not locate packages/mania-difficulty root");
}

static string ResolveUpstream(string packageRoot, UpstreamConfig config, RevisionInfo revision)
{
    var env = Environment.GetEnvironmentVariable(config.CheckoutDirEnv ?? "MANIA_DIFFICULTY_UPSTREAM");
    if (!string.IsNullOrWhiteSpace(env) && Directory.Exists(env))
        return Path.GetFullPath(env);

    var cached = Path.Combine(packageRoot, config.DefaultCheckoutRelative ?? ".cache/upstream");
    if (Directory.Exists(Path.Combine(cached, "osu.Game")))
        return Path.GetFullPath(cached);

    const string tmp = "/tmp/opencode/osu-mania-difficulty";
    if (Directory.Exists(tmp))
        return tmp;

    throw new InvalidOperationException(
        $"Upstream checkout not found. Set {config.CheckoutDirEnv} or clone {revision.Repository}@{revision.Sha} to {cached}");
}

static void WriteManifest(string generatedRoot, RevisionInfo revision, List<EmittedFile> files)
{
    // No wall-clock timestamp — generation must be idempotent (empty git diff).
    var manifest = new
    {
        upstreamSha = revision.Sha,
        generatorVersion = revision.GeneratorVersion,
        files = files.Select(f => new { path = f.Path, sha256 = f.Sha256 }).ToArray(),
    };
    Directory.CreateDirectory(generatedRoot);
    File.WriteAllText(
        Path.Combine(generatedRoot, "manifest.json"),
        JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }) + "\n");
}

static string NormalizeNewlines(string s) => s.Replace("\r\n", "\n").Replace('\r', '\n');

static string Sha256Hex(string text)
{
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(text));
    return Convert.ToHexString(hash).ToLowerInvariant();
}

static JsonSerializerOptions JsonOpts() => new()
{
    PropertyNameCaseInsensitive = true,
    ReadCommentHandling = JsonCommentHandling.Skip,
};

sealed record EmittedFile(string Path, string Sha256, string Content);

namespace ManiaDifficulty.Transpiler
{
    public sealed class RevisionInfo
    {
        public string Repository { get; set; } = "";
        public string Branch { get; set; } = "";
        public string Sha { get; set; } = "";
        public string GeneratorVersion { get; set; } = "0.0.0";
    }

    sealed class UpstreamConfig
    {
        public string? CheckoutDirEnv { get; set; }
        public string? DefaultCheckoutRelative { get; set; }
        public List<string> GenerateRoots { get; set; } = new();
    }
}
