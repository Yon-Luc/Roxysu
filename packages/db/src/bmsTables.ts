import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBmsTableJson, type BmsParsedTable } from "./bmsInterpret";

const FILES = ["insane.json", "satellite.json", "stella.json"] as const;

export type BundledBmsTable = {
  sourceUrl: string;
  tableId: string;
  versionId: string;
  parsed: BmsParsedTable;
};

function tablesDir(): string {
  const beside = path.join(path.dirname(fileURLToPath(import.meta.url)), "../bms-tables");
  if (existsSync(beside)) return beside;
  const cwd = path.join(process.cwd(), "bms-tables");
  if (existsSync(cwd)) return cwd;
  throw new Error("bundled BMS tables are missing");
}

export function bundledTableIdentity(sourceUrl: string, parsed: BmsParsedTable) {
  const tableId = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
  const versionId = createHash("sha256")
    .update(JSON.stringify({ sourceUrl, levelOrder: parsed.levelOrder, entries: parsed.entries }))
    .digest("hex");
  return { tableId, versionId };
}

/** Insane, Satellite, and Stella catalogues shipped with the repo. */
export function loadBundledBmsTables(): BundledBmsTable[] {
  const dir = tablesDir();
  return FILES.map((file) => {
    const sourceUrl = `bundled://bms-tables/${file}`;
    const parsed = parseBmsTableJson(readFileSync(path.join(dir, file), "utf8"), file);
    if (!parsed || parsed.entries.length === 0) {
      throw new Error(`bundled BMS table ${file} has no charts`);
    }
    return { sourceUrl, parsed, ...bundledTableIdentity(sourceUrl, parsed) };
  });
}
