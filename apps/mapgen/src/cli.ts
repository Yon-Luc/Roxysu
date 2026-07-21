#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { analyzeAudioFile, isFfmpegAvailable } from "@roxysu/audio-analysis";
import {
  analyzeGeneratedPatterns,
  buildManiaOsuText,
  generateMapFromAudio,
  normalizeTargets,
} from "@roxysu/mapgen-core";

type CliArgs = {
  mp3: string;
  output: string;
  title?: string;
  artist?: string;
  creator: string;
  version: string;
  bpm?: number;
  seed?: number;
  endSec?: number;
  delay?: number;
  jack?: number;
  chordjack?: number;
  chordstream?: number;
  bracket?: number;
  ln?: number;
  dan?: string;
  versionCode: 1 | 2;
  audioAlgorithm: "audio-v1" | "audio-v2";
  ffmpegPath?: string;
  verify: boolean;
  help: boolean;
};

function printHelp(): void {
  console.log(`Roxysu mapgen — generate a 7K mania .osu from an audio file

Usage:
  bun run --cwd apps/mapgen start -- --mp3 song.mp3 -o chart.osu [options]

Required:
  --mp3, -i          Input audio file (mp3/ogg/wav — anything ffmpeg decodes)
  --output, -o       Output .osu path

Pattern targets (0–1, normalized automatically):
  --delay            Delay/stream notes (default 0.45)
  --jack             Jack segments (default 0.15)
  --chordjack        Chordjack segments (default 0.15)
  --chordstream      Chordstream segments (default 0.10)
  --bracket          Bracket segments (default 0.10)
  --ln               Long note ratio among generated notes (default 0.15)

Metadata:
  --title            Chart title (default: audio filename)
  --artist           Artist (default: Unknown)
  --creator          Mapper name (default: Roxysu Mapgen)
  --version          Difficulty name (default: Generated)

Other:
  --bpm              Override detected BPM
  --dan              Target Sunny dan preset (regular-4, ln-5, "Regular 4", …)
  --seed             RNG seed for reproducible patterns
  --end              Stop generating after N seconds
  --v1               Use the old template backend
  --audio-algo       audio-v1 or audio-v2 (default: audio-v2)
  --ffmpeg           Path to ffmpeg binary (or set FFMPEG_PATH)
  --verify           Print pattern-7k analysis of output
  --help, -h         Show this help

Examples:
  bun run mapgen -- --mp3 track.mp3 -o out.osu --delay 0.5 --ln 0.2
  bun run mapgen -- --mp3 track.mp3 -o out.osu --dan regular-4 --seed 1

Requires ffmpeg on PATH (nix develop includes it).
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mp3: "",
    output: "",
    creator: "Roxysu Mapgen",
    version: "Generated",
    versionCode: 2,
    audioAlgorithm: "audio-v2",
    verify: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = argv[i + 1];
    switch (a) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--mp3":
      case "-i":
        args.mp3 = next ?? "";
        i += 1;
        break;
      case "--output":
      case "-o":
        args.output = next ?? "";
        i += 1;
        break;
      case "--title":
        args.title = next;
        i += 1;
        break;
      case "--artist":
        args.artist = next;
        i += 1;
        break;
      case "--creator":
        args.creator = next ?? args.creator;
        i += 1;
        break;
      case "--version":
        args.version = next ?? args.version;
        i += 1;
        break;
      case "--bpm":
        args.bpm = Number(next);
        i += 1;
        break;
      case "--seed":
        args.seed = Number(next);
        i += 1;
        break;
      case "--end":
        args.endSec = Number(next);
        i += 1;
        break;
      case "--delay":
        args.delay = Number(next);
        i += 1;
        break;
      case "--jack":
        args.jack = Number(next);
        i += 1;
        break;
      case "--chordjack":
        args.chordjack = Number(next);
        i += 1;
        break;
      case "--chordstream":
        args.chordstream = Number(next);
        i += 1;
        break;
      case "--bracket":
        args.bracket = Number(next);
        i += 1;
        break;
      case "--ln":
        args.ln = Number(next);
        i += 1;
        break;
      case "--dan":
        args.dan = next;
        i += 1;
        break;
      case "--v1":
        args.versionCode = 1;
        break;
      case "--audio-algo":
        args.audioAlgorithm = next === "audio-v1" ? "audio-v1" : "audio-v2";
        i += 1;
        break;
      case "--ffmpeg":
        args.ffmpegPath = next;
        i += 1;
        break;
      case "--verify":
        args.verify = true;
        break;
      default:
        if (a.startsWith("-")) {
          console.error(`Unknown option: ${a}`);
          process.exit(1);
        }
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.mp3 || !args.output) {
    console.error("Error: --mp3 and --output are required\n");
    printHelp();
    process.exit(1);
  }

  const ffmpegPath =
    args.ffmpegPath ?? process.env.FFMPEG_PATH?.trim() ?? "ffmpeg";
  if (!(await isFfmpegAvailable(ffmpegPath))) {
    console.error(
      "Error: ffmpeg not found. Use nix develop, install ffmpeg, or set --ffmpeg / FFMPEG_PATH",
    );
    process.exit(1);
  }

  const mp3Path = resolve(args.mp3);
  const outPath = resolve(args.output);
  const audioBasename = basename(mp3Path);

  console.log(`Analyzing audio: ${mp3Path}`);
  const audio = await analyzeAudioFile(mp3Path, {
    ffmpegPath,
    algorithm: args.audioAlgorithm,
  });

  const targets = normalizeTargets({
    delay: args.delay,
    jack: args.jack,
    chordjack: args.chordjack,
    chordstream: args.chordstream,
    bracket: args.bracket,
    ln: args.ln,
  });

  console.log(
    `BPM: ${audio.bpm?.toFixed(1) ?? "?"} (confidence ${((audio.bpmConfidence ?? 0) * 100).toFixed(0)}%)` +
      (audio.bpmAlternates?.length
        ? ` alts=[${audio.bpmAlternates.join(", ")}]`
        : "") +
      ` offset=${audio.timingOffsetMs}ms`,
  );
  console.log(`Targets: ${JSON.stringify(targets)}`);

  const result = generateMapFromAudio(
    audio,
    {
      delay: args.delay,
      jack: args.jack,
      chordjack: args.chordjack,
      chordstream: args.chordstream,
      bracket: args.bracket,
      ln: args.ln,
    },
    {
      bpm: args.bpm,
      seed: args.seed,
      dan: args.dan,
      version: args.versionCode,
      endMs: args.endSec != null ? args.endSec * 1000 : undefined,
      metadata: {
        title: args.title ?? audioBasename.replace(/\.[^.]+$/, ""),
        artist: args.artist ?? "Unknown",
        creator: args.creator,
        version: args.version === "Generated" && args.dan ? undefined : args.version,
      },
      audioFilename: audioBasename,
    },
  );

  const osuText = buildManiaOsuText(result.chart);
  writeFileSync(outPath, osuText, "utf8");

  console.log(
    `Wrote ${result.notes.length} objects → ${outPath}`,
  );
  console.log(
    `Timing points: ${result.timingPoints.length}` +
      (result.timingPoints.length > 1
        ? ` (${result.timingPoints
            .map(([t, b]) => `${Math.round(t)}ms@${(60_000 / b).toFixed(1)}`)
            .join(", ")})`
        : ""),
  );
  console.log(
    `Segments: ${result.segments.length} (${result.segments.map((s) => s.pattern).join(", ")})`,
  );
  if (result.dan) {
    console.log(`Dan target: ${result.dan.label} (LN ${(result.targets.ln * 100).toFixed(0)}%)`);
  }

  if (args.verify) {
    const analysis = analyzeGeneratedPatterns(result.notes);
    console.log("\nPattern verification (7k-structural-v2):");
    console.log(`  Dominant: ${analysis.dominantPattern} (${(analysis.confidence * 100).toFixed(0)}% confidence)`);
    console.log(`  Composition: ${JSON.stringify(analysis.composition)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
