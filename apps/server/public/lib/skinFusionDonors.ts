import { sanitizeZipEntryPath } from "../../src/shared/zipEntryPath";
import {
  rebaseToSkinRoot,
  unzipSkinFiles,
  type SkinFiles,
} from "@server/shared/skinFusion/fileMap";
import { buildDonor, type SkinDonor } from "@server/shared/skinFusion/plan";

/** Build a fusion donor from `.osk` bytes (Realm archive endpoint or a picked file). */
export function donorFromArchiveBytes(args: {
  id: string;
  label: string;
  creator?: string | null;
  bytes: Uint8Array | ArrayBuffer;
}): SkinDonor {
  const data = args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes);
  const files = rebaseToSkinRoot(unzipSkinFiles(data));
  if (!files.has("skin.ini")) throw new Error("No skin.ini found in this skin");
  return buildDonor({ id: args.id, label: args.label, creator: args.creator, files });
}

/** Build a donor from a picked `.osk` / `.zip`, or from a folder picked with `webkitdirectory`. */
export async function donorFromFileList(
  id: string,
  list: FileList | File[],
): Promise<SkinDonor> {
  const picked = [...list];
  const archive = picked.find((f) => /\.(osk|zip)$/i.test(f.name));
  if (archive) {
    return donorFromArchiveBytes({
      id,
      label: archive.name.replace(/\.(osk|zip)$/i, ""),
      bytes: new Uint8Array(await archive.arrayBuffer()),
    });
  }
  const files: SkinFiles = new Map();
  let folderName = "";
  await Promise.all(
    picked.map(async (file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const raw = rel && rel.length > 0 ? rel : file.name;
      if (!folderName && rel) folderName = rel.split("/")[0] ?? "";
      const safe = sanitizeZipEntryPath(raw);
      if (!safe) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > 0) files.set(safe, bytes);
    }),
  );
  const rebased = rebaseToSkinRoot(files);
  if (!rebased.has("skin.ini")) throw new Error("No skin.ini found in this folder");
  return buildDonor({ id, label: folderName || "Skin folder", files: rebased });
}

export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Characters lazer's `GetValidFilename` strips. The archive name must survive that or lazer renames the skin. */
const LAZER_INVALID_FILENAME = /["<>|\u0000-\u001f:*?\\/]/g;

/** How osu!lazer lists the skin: `Name` or `Name (Creator)`. */
export function lazerDisplayName(name: string, creator: string): string {
  const trimmedName = name.trim();
  const trimmedCreator = creator.trim();
  return (trimmedCreator ? `${trimmedName} (${trimmedCreator})` : trimmedName).trim();
}

/**
 * `.osk` filename lazer accepts without appending `[filename]` to the skin name.
 * Matches `SkinInfo.ToString().GetValidFilename()`: invalid characters are removed, not replaced.
 */
export function safeOskFilename(name: string, creator = ""): string {
  const cleaned = lazerDisplayName(name, creator).replace(LAZER_INVALID_FILENAME, "").trim();
  return `${cleaned.length > 0 ? cleaned.slice(0, 180) : "fusion"}.osk`;
}
