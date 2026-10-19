import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseBmsImageFilename } from "@roxysu/db/bms";
import { resolveLazerFilePath } from "../shared/lazer-files";

const HEADER_BYTES = 1024 * 1024;

export function readChartHeader(filePath: string, maxBytes = HEADER_BYTES): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const length = Math.min(fstatSync(fd).size, maxBytes);
    if (length <= 0) return null;
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, 0);
    return buf.toString("latin1");
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

/** Resolve a chart image name to a file inside the BMS source folder. */
export function stageImageInsideSource(sourceDir: string, filename: string): string | null {
  let root: string;
  try {
    root = realpathSync(sourceDir);
  } catch {
    return null;
  }
  const names = [filename, path.basename(filename)].filter(
    (name, index, all) => name && name !== "." && name !== ".." && all.indexOf(name) === index,
  );
  for (const name of names) {
    let real: string;
    try {
      real = realpathSync(path.resolve(root, name));
    } catch {
      continue;
    }
    if (real === root || real.startsWith(root + path.sep)) return real;
  }
  return null;
}

export function resolveBmsStageImage(input: {
  sourceDir: string | null;
  chartHash: string | null;
  osuDataPath?: string;
}): string | null {
  if (!input.sourceDir || !input.chartHash) return null;
  const chartPath = resolveLazerFilePath(input.chartHash, input.osuDataPath);
  if (!chartPath) return null;
  const text = readChartHeader(chartPath);
  if (!text) return null;
  const filename = parseBmsImageFilename(text);
  if (!filename) return null;
  return stageImageInsideSource(input.sourceDir, filename);
}

export function sniffStageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
