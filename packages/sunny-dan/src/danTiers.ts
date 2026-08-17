import { DAN_INDEX, type DanInterval } from "./intervals/index.js";

const BAND_SUFFIX = / (low|mid\/low|mid|mid\/high|high)$/i;

export function danTierFromLabel(label: string): string {
  return label.replace(BAND_SUFFIX, "").trim();
}

export function danTiersFromTable(table: DanInterval[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of table) {
    const tier = danTierFromLabel(row[2]);
    if (!tier || seen.has(tier)) continue;
    seen.add(tier);
    out.push(tier);
  }
  return out;
}

export function danTiersForKeyCount(
  keyCount: number,
  table: "RC" | "LN" = "RC",
): string[] {
  const keys = DAN_INDEX[keyCount];
  if (!keys) return [];
  return danTiersFromTable(keys[table].default);
}

export function danQueryForTier(tier: string): string {
  const escaped = tier.replace(/"/g, "");
  return `dan:"${escaped}"`;
}
