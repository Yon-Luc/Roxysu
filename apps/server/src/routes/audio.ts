import { Elysia, t } from "elysia";
import { serveHashedFile } from "../shared/serveHashedFile";

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
    const result = await serveHashedFile(
      params.hash,
      sniffAudioMime,
      "Audio not found",
      "Not an audio file",
    );
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }

    set.headers["content-type"] = result.contentType;
    set.headers["cache-control"] = "public, max-age=604800, immutable";
    set.headers["accept-ranges"] = "bytes";
    return result.file;
  },
  {
    params: t.Object({
      hash: t.String(),
    }),
  },
);
