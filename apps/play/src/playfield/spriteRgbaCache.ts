import type { PlayfieldSkinSprites } from "../skin/PlayfieldSkin";
import { decodeImageRgba, decodeImageRgbaSync } from "./imageRgba";
import type { RgbaImage } from "./pngRgba";

const cache = new Map<string, RgbaImage | null>();
const pending = new Map<string, Promise<RgbaImage | null>>();

export function getSpriteRgba(filePath: string): RgbaImage | null {
  if (!cache.has(filePath)) return null;
  return cache.get(filePath) ?? null;
}

/** Decode on first use (sync) and cache — safe to call every frame. */
export function loadSpriteRgbaSync(filePath: string): RgbaImage | null {
  if (cache.has(filePath)) {
    return cache.get(filePath) ?? null;
  }

  const decoded = decodeImageRgbaSync(filePath);
  cache.set(filePath, decoded);
  return decoded;
}

export async function preloadSpriteRgba(
  filePath: string,
): Promise<RgbaImage | null> {
  if (cache.has(filePath)) {
    return cache.get(filePath) ?? null;
  }

  const inflight = pending.get(filePath);
  if (inflight) return inflight;

  const task = decodeImageRgba(filePath)
    .then((decoded) => {
      cache.set(filePath, decoded);
      pending.delete(filePath);
      return decoded;
    })
    .catch(() => {
      cache.set(filePath, null);
      pending.delete(filePath);
      return null;
    });

  pending.set(filePath, task);
  return task;
}

export async function preloadSkinSpritePaths(
  paths: Iterable<string>,
): Promise<void> {
  const unique = [...new Set(paths)].filter((path) => path.length > 0);
  await Promise.all(unique.map((path) => preloadSpriteRgba(path)));
}

export function collectSkinSpritePaths(
  sprites: PlayfieldSkinSprites | null,
): string[] {
  if (!sprites) return [];

  const paths: string[] = [];
  const add = (value: string | null | undefined) => {
    if (value) paths.push(value);
  };

  for (const list of [
    sprites.notes,
    sprites.bodies,
    sprites.tails,
    sprites.keysUp,
    sprites.keysDown,
  ]) {
    for (const spritePath of list) add(spritePath);
  }

  add(sprites.stageLeft);
  add(sprites.stageRight);
  return paths;
}

export function clearSpriteRgbaCache(): void {
  cache.clear();
  pending.clear();
}
