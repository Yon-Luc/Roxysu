import { resolveFfmpegPath } from "./resolveFfmpegPath";
import type { DecodeAudioOptions, DecodedAudio } from "./types";

const DEFAULT_SAMPLE_RATE = 22_050;

/** Decode an audio file to mono float32 PCM using ffmpeg. */
export async function decodeAudioFile(
  filePath: string,
  options: DecodeAudioOptions = {},
): Promise<DecodedAudio> {
  const ffmpegPath = options.ffmpegPath ?? (await resolveFfmpegPath());
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;

  const proc = Bun.spawn(
    [
      ffmpegPath,
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "pipe:1",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdoutBuf, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `ffmpeg failed (${exitCode}): ${stderrText.trim() || "unknown error"}`,
    );
  }

  const samples = new Float32Array(stdoutBuf);
  const durationMs = (samples.length / sampleRate) * 1000;

  return { samples, sampleRate, durationMs };
}

export { isFfmpegAvailable } from "./resolveFfmpegPath";
