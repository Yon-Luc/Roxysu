import { existsSync } from "node:fs";
import { accessSync, constants } from "node:fs";

/** Env override for the ffmpeg binary (useful on NixOS / non-FHS layouts). */
export function resolveFfmpegPath(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return fromEnv;
  return "ffmpeg";
}

export async function isFfmpegAvailableAt(
  ffmpegPath = resolveFfmpegPath(),
): Promise<boolean> {
  if (ffmpegPath !== "ffmpeg" && existsSync(ffmpegPath)) {
    try {
      accessSync(ffmpegPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const proc = Bun.spawn([ffmpegPath, "-version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

export function ffmpegUnavailableMessage(
  ffmpegPath = resolveFfmpegPath(),
): string {
  if (ffmpegPath !== "ffmpeg") {
    return `ffmpeg not found or not executable at ${ffmpegPath}`;
  }
  return "ffmpeg is not available on PATH — install ffmpeg or set FFMPEG_PATH (NixOS: nix develop / add pkgs.ffmpeg to your shell)";
}
