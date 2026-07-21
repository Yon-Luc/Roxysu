import { existsSync } from "node:fs";
import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";

const MAX_FLAKE_WALK_DEPTH = 12;
const DEFAULT_FFMPEG = "ffmpeg";

/** Well-known nix locations when IDE sandboxes strip PATH. */
const NIX_CANDIDATES = [
  "/run/current-system/sw/bin/nix",
  "/nix/var/nix/profiles/default/bin/nix",
];

/** Matches the system triplet declared in flake.nix. */
function nixSystemTriplet(): string {
  if (process.arch === "arm64") return "aarch64-linux";
  return "x86_64-linux";
}

function isExecutable(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the nix CLI even when it is missing from PATH. */
export function resolveNixBinary(): string | null {
  const fromPath = Bun.which("nix");
  if (fromPath) return fromPath;

  for (const candidate of NIX_CANDIDATES) {
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

/** Walk parents from `startDir` looking for a flake.nix (max 12 levels). */
export function findFlakeRoot(
  startDir: string,
  maxDepth = MAX_FLAKE_WALK_DEPTH,
): string | null {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i += 1) {
    if (existsSync(join(dir, "flake.nix"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Search cwd and this module's tree for the repo flake root. */
export function findProjectFlakeRoot(): string | null {
  const candidates = [process.cwd(), import.meta.dir];
  const seen = new Set<string>();

  for (const startDir of candidates) {
    const root = findFlakeRoot(startDir);
    if (root && !seen.has(root)) {
      seen.add(root);
      return root;
    }
  }

  return null;
}

let cachedResolvedPath: string | undefined;

/** Clear the in-memory resolver cache (for tests). */
export function resetFfmpegPathCache(): void {
  cachedResolvedPath = undefined;
}

async function tryNixFlakeFfmpeg(): Promise<string | null> {
  const nix = resolveNixBinary();
  if (!nix) return null;

  const flakeRoot = findProjectFlakeRoot();
  if (!flakeRoot) return null;

  const system = nixSystemTriplet();
  const attr = `.#packages.${system}.ffmpeg.outPath`;

  try {
    const proc = Bun.spawn([nix, "eval", "--raw", attr], {
      cwd: flakeRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [outPath, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return null;

    const trimmed = outPath.trim();
    if (!trimmed) return null;

    const ffmpegPath = `${trimmed}/bin/ffmpeg`;
    if (!isExecutable(ffmpegPath)) return null;

    return ffmpegPath;
  } catch {
    return null;
  }
}

/** Resolve the ffmpeg binary: FFMPEG_PATH → PATH → Nix flake → "ffmpeg". */
export async function resolveFfmpegPath(): Promise<string> {
  if (cachedResolvedPath) return cachedResolvedPath;

  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) {
    cachedResolvedPath = fromEnv;
    return fromEnv;
  }

  const fromPath = Bun.which("ffmpeg");
  if (fromPath) {
    cachedResolvedPath = fromPath;
    return fromPath;
  }

  const fromNix = await tryNixFlakeFfmpeg();
  if (fromNix) {
    cachedResolvedPath = fromNix;
    return fromNix;
  }

  return DEFAULT_FFMPEG;
}

/** Returns true when ffmpeg is available at the given path (or after auto-resolve). */
export async function isFfmpegAvailable(
  ffmpegPath?: string,
): Promise<boolean> {
  const path = ffmpegPath ?? (await resolveFfmpegPath());

  if (path !== DEFAULT_FFMPEG && isExecutable(path)) {
    return true;
  }

  try {
    const proc = Bun.spawn([path, "-version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

export function ffmpegUnavailableMessage(ffmpegPath: string): string {
  if (ffmpegPath !== DEFAULT_FFMPEG) {
    return `ffmpeg not found or not executable at ${ffmpegPath}`;
  }
  return "ffmpeg is not available on PATH — install ffmpeg or set FFMPEG_PATH (NixOS: nix develop / add pkgs.ffmpeg to your shell)";
}
