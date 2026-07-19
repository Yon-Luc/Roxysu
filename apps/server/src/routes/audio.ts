import { Elysia, t } from "elysia";
import {
  defaultOsuDataPath,
  isLazerFileHash,
  resolveLazerFilePath,
} from "../shared/lazer-files";

const osuDataPath = defaultOsuDataPath();

function sniffAudioMime(bytes: Uint8Array): string | null {
  // MP3 with ID3 tag
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio/mpeg";
  }
  // MP3 frame sync
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  // Ogg
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return "audio/ogg";
  }
  // WAV (RIFF....WAVE)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "audio/wav";
  }
  // FLAC
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  ) {
    return "audio/flac";
  }
  return null;
}

export const audioRoutes = new Elysia({ prefix: "/audio" }).get(
  "/:hash",
  async ({ params, set }) => {
    const hash = params.hash.toLowerCase();
    if (!isLazerFileHash(hash)) {
      set.status = 400;
      return { error: "Invalid file hash" };
    }

    const filePath = resolveLazerFilePath(hash, osuDataPath);
    if (!filePath) {
      set.status = 400;
      return { error: "Invalid file hash" };
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      set.status = 404;
      return { error: "Audio not found" };
    }

    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const type = sniffAudioMime(head);
    if (!type) {
      set.status = 415;
      return { error: "Not an audio file" };
    }

    set.headers["content-type"] = type;
    set.headers["cache-control"] = "public, max-age=604800, immutable";
    set.headers["accept-ranges"] = "bytes";
    return file;
  },
  {
    params: t.Object({
      hash: t.String(),
    }),
  },
);
