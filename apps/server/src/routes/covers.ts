import { Elysia, t } from "elysia";
import {
  defaultOsuDataPath,
  isLazerFileHash,
  resolveLazerFilePath,
} from "../shared/lazer-files";

const osuDataPath = defaultOsuDataPath();

function sniffImageMime(bytes: Uint8Array): string | null {
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
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
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
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return "image/avif";
  }
  return null;
}

export const coverRoutes = new Elysia({ prefix: "/covers" }).get(
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
      return { error: "Cover not found" };
    }

    // Lazer stores files by hash with no extension — sniff content type.
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const type = sniffImageMime(head);
    if (!type) {
      set.status = 415;
      return { error: "Not an image" };
    }

    set.headers["content-type"] = type;
    set.headers["cache-control"] = "public, max-age=604800, immutable";
    return file;
  },
  {
    params: t.Object({
      hash: t.String(),
    }),
  },
);
