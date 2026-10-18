/**
 * BMS score interpretation shared by the client app and the Hub.
 *
 * Formulas match QingQiz/BmsRuleset as verified against local Realm scores:
 * EX = perfect*2 + great, max EX = maximum perfect*2, accuracy = EX / max EX.
 * HitResult names from BmsScoreProcessor: Perfect PGREAT, Great GREAT,
 * Good GOOD, Ok BAD, Meh POOR, Miss (includes empty poor; they are not split).
 * Clear/fail is not on the score row. Gauge is only set when a gauge mod is present.
 * Auto Gauge (`AG`) is the ruleset's stored marker for a resolved Normal gauge.
 */

export const BMS_RULESET = "bms";

/** Mods that change competitive comparability. Gauge mods are not in this set. */
export const BMS_PARTITION_MODS = [
  "2P",
  "AS",
  "CN",
  "DT",
  "HS",
  "HT",
  "L1",
  "L2",
  "L3",
] as const;

const PARTITION = new Set<string>(BMS_PARTITION_MODS);

/** osu! ModAutoplay acronym, inherited by BmsModAutoplay. */
export const BMS_AUTOPLAY_ACRONYM = "AT";

export const BMS_GAUGE_BY_ACRONYM: Record<string, string> = {
  E2: "assist_easy",
  E1: "easy",
  AG: "normal",
  H1: "hard",
  H2: "ex_hard",
  H3: "hazard",
  C1: "class",
  C2: "ex_class",
  C3: "ex_hard_class",
};

export const BMS_GAUGE_IDS = new Set(Object.values(BMS_GAUGE_BY_ACRONYM));

export const BMS_DJ_GRADES = ["max", "aaa", "aa", "a", "b", "d"] as const;
export type BmsDjGrade = (typeof BMS_DJ_GRADES)[number];

const GRADE_RANK: Record<string, number> = {
  max: 6,
  aaa: 5,
  aa: 4,
  a: 3,
  b: 2,
  d: 1,
};

export type BmsJudgements = {
  pgreat: number | null;
  great: number | null;
  good: number | null;
  bad: number | null;
  poor: number | null;
  /** Combined miss and empty poor. */
  miss: number | null;
  /** Empty poor is not stored separately from miss. */
  ePoor: null;
};

export type BmsInterpretation = {
  exScore: number | null;
  maxExScore: number | null;
  normalizedScore: number;
  accuracy: number;
  judgements: BmsJudgements;
  variantId: string;
  gaugeId: string | null;
  comboLampId: "max" | "perfect" | "fc" | null;
  clearLampId: null;
  djGrade: BmsDjGrade;
  modAcronyms: string[];
  autoplay: boolean;
};

function readCount(raw: Record<string, unknown>, key: string): number | null {
  if (!(key in raw)) return null;
  const value = raw[key];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseModAcronyms(mods: string | null | undefined): string[] {
  if (mods == null || mods.trim() === "") return [];
  try {
    const parsed = JSON.parse(mods) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim()) {
        out.push(item.trim().toUpperCase());
        continue;
      }
      if (item && typeof item === "object" && "acronym" in item) {
        const acronym = (item as { acronym?: unknown }).acronym;
        if (typeof acronym === "string" && acronym.trim()) {
          out.push(acronym.trim().toUpperCase());
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Sorted partition mods, or `standard` when none are present. */
export function variantIdFromAcronyms(acronyms: readonly string[]): string {
  const parts = [...new Set(acronyms.filter((a) => PARTITION.has(a)))].sort();
  return parts.length === 0 ? "standard" : parts.join("+");
}

export function isKnownVariantId(variantId: string): boolean {
  if (variantId === "standard") return true;
  const parts = variantId.split("+");
  if (parts.length === 0 || parts.some((part) => !PARTITION.has(part))) return false;
  const sorted = [...parts].sort();
  return parts.every((part, i) => part === sorted[i]) && new Set(parts).size === parts.length;
}

/** Specific gauge mods win over Auto Gauge. No gauge mod stays null. */
export function gaugeIdFromAcronyms(acronyms: readonly string[]): string | null {
  const specific = acronyms.filter(
    (a) => a !== "AG" && BMS_GAUGE_BY_ACRONYM[a] != null,
  );
  if (specific.length > 0) {
    return BMS_GAUGE_BY_ACRONYM[specific[0]!] ?? null;
  }
  if (acronyms.includes("AG")) return "normal";
  return null;
}

export function djGradeFromAccuracy(accuracy: number): BmsDjGrade {
  if (!Number.isFinite(accuracy) || accuracy < 0) return "d";
  if (accuracy >= 1 - 1e-9) return "max";
  if (accuracy >= 8 / 9) return "aaa";
  if (accuracy >= 7 / 9) return "aa";
  if (accuracy >= 6 / 9) return "a";
  if (accuracy >= 5 / 9) return "b";
  return "d";
}

export function gradeMeets(grade: string | null, minimum: BmsDjGrade): boolean {
  if (grade == null) return false;
  return (GRADE_RANK[grade] ?? 0) >= (GRADE_RANK[minimum] ?? 0);
}

export function comboLampMeets(
  lamp: string | null,
  minimum: "fc" | "perfect" | "max",
): boolean {
  if (lamp == null) return false;
  const rank = lamp === "max" ? 3 : lamp === "perfect" ? 2 : lamp === "fc" ? 1 : 0;
  const need = minimum === "max" ? 3 : minimum === "perfect" ? 2 : 1;
  return rank >= need;
}

function comboLamp(j: BmsJudgements): "max" | "perfect" | "fc" | null {
  const pgreat = j.pgreat ?? 0;
  const great = j.great ?? 0;
  const good = j.good ?? 0;
  const bad = j.bad ?? 0;
  const poor = j.poor ?? 0;
  const miss = j.miss ?? 0;
  if (j.pgreat == null && j.great == null && j.good == null) return null;
  const scored = pgreat + great + good + bad + poor + miss;
  if (scored <= 0) return null;
  if (bad + poor + miss > 0) return null;
  if (good === 0 && great === 0 && pgreat > 0) return "max";
  if (good === 0) return "perfect";
  return "fc";
}

export function interpretBmsScore(input: {
  statistics: string | null | undefined;
  maximumStatistics: string | null | undefined;
  mods: string | null | undefined;
  totalScore: number;
  accuracy: number;
}): BmsInterpretation {
  const stats = parseObject(input.statistics);
  const maximum = parseObject(input.maximumStatistics);
  const judgements: BmsJudgements = stats
    ? {
        pgreat: readCount(stats, "perfect"),
        great: readCount(stats, "great"),
        good: readCount(stats, "good"),
        bad: readCount(stats, "ok"),
        poor: readCount(stats, "meh"),
        miss: readCount(stats, "miss"),
        ePoor: null,
      }
    : {
        pgreat: null,
        great: null,
        good: null,
        bad: null,
        poor: null,
        miss: null,
        ePoor: null,
      };

  const exScore =
    judgements.pgreat == null && judgements.great == null
      ? null
      : (judgements.pgreat ?? 0) * 2 + (judgements.great ?? 0);
  const maxPerfect = maximum ? readCount(maximum, "perfect") : null;
  const maxExScore = maxPerfect == null ? null : maxPerfect * 2;
  const acronyms = parseModAcronyms(input.mods);
  const accuracy = Number.isFinite(input.accuracy) ? input.accuracy : 0;

  return {
    exScore,
    maxExScore,
    normalizedScore: Number.isFinite(input.totalScore)
      ? Math.max(0, Math.floor(input.totalScore))
      : 0,
    accuracy,
    judgements,
    variantId: variantIdFromAcronyms(acronyms),
    gaugeId: gaugeIdFromAcronyms(acronyms),
    comboLampId: comboLamp(judgements),
    clearLampId: null,
    djGrade: djGradeFromAccuracy(accuracy),
    modAcronyms: acronyms,
    autoplay: acronyms.includes(BMS_AUTOPLAY_ACRONYM),
  };
}

export type BmsTableChart = {
  level: string;
  levelIndex: number;
  md5: string | null;
  sha256: string | null;
  title: string | null;
  artist: string | null;
};

export type BmsParsedTable = {
  name: string;
  symbol: string;
  dataUrl: string | null;
  levelOrder: string[];
  entries: BmsTableChart[];
  unresolvedCount: number;
};

function isHex(value: string, length: number): boolean {
  if (value.length !== length) return false;
  return /^[0-9a-f]+$/i.test(value);
}

function readString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

function levelSort(a: string, b: string): number {
  const an = Number(a.replace(/^[^\d.-]+/, ""));
  const bn = Number(b.replace(/^[^\d.-]+/, ""));
  const aNum = Number.isFinite(an) && /[\d]/.test(a);
  const bNum = Number.isFinite(bn) && /[\d]/.test(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  if (aNum && an !== bn) return an - bn;
  return a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b);
}

/**
 * Parse a beatoraja difficulty-table header or chart array.
 * Entries without a valid MD5 or SHA-256 count as unresolved and are dropped.
 */
export function parseBmsTableJson(
  json: string,
  sourceName: string,
): BmsParsedTable | null {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return null;
  }

  const header = root != null && typeof root === "object" && !Array.isArray(root)
    ? (root as Record<string, unknown>)
    : null;
  const chartSource = Array.isArray(root)
    ? root
    : header && Array.isArray(header.charts)
      ? header.charts
      : null;

  const name = readString(header?.name) ?? sourceName;
  const symbol = readString(header?.symbol) ?? "";
  const dataUrl = readString(header?.data_url);
  let levelOrder = Array.isArray(header?.level_order)
    ? header.level_order.filter((item): item is string => typeof item === "string")
    : [];

  if (chartSource == null) {
    if (dataUrl) {
      return {
        name,
        symbol,
        dataUrl,
        levelOrder,
        entries: [],
        unresolvedCount: 0,
      };
    }
    return null;
  }

  const entries: BmsTableChart[] = [];
  let unresolvedCount = 0;
  for (const item of chartSource) {
    if (item == null || typeof item !== "object") {
      unresolvedCount += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const md5Raw = readString(row.md5);
    const shaRaw = readString(row.sha256);
    const md5 = md5Raw && isHex(md5Raw, 32) ? md5Raw.toLowerCase() : null;
    const sha256 = shaRaw && isHex(shaRaw, 64) ? shaRaw.toLowerCase() : null;
    if (!md5 && !sha256) {
      unresolvedCount += 1;
      continue;
    }
    entries.push({
      level: readString(row.level) ?? "",
      levelIndex: 0,
      md5,
      sha256,
      title: readString(row.title),
      artist: readString(row.artist),
    });
  }

  if (levelOrder.length === 0) {
    levelOrder = [...new Set(entries.map((entry) => entry.level))].sort(levelSort);
  }
  const index = new Map(levelOrder.map((level, i) => [level.toLowerCase(), i]));
  for (const entry of entries) {
    entry.levelIndex = index.get(entry.level.toLowerCase()) ?? levelOrder.length;
  }

  if (entries.length === 0 && !dataUrl) return null;
  return { name, symbol, dataUrl, levelOrder, entries, unresolvedCount };
}

/** Hosts accepted for Hub table import. The ruleset stores user-supplied URLs; Hub does not fetch arbitrary hosts. */
export const BMS_TABLE_HOSTS = [
  "rattoto10.jounin.jp",
  "stellabms.xyz",
  "bms.hexlataia.xyz",
  "mind.nekokan.dyndns.info",
  "bmssearch.net",
  "mirror.bmssearch.net",
] as const;

export function isAllowedBmsTableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.hostname.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return BMS_TABLE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

export type BmsSessionScore = {
  id: string;
  playedAt: number;
  exScore: number | null;
  normalizedScore: number;
};

const SESSION_GAP_MS = 30 * 60 * 1000;

export function groupBmsSessions<T extends BmsSessionScore>(
  scores: readonly T[],
): Array<{
  startedAt: number;
  endedAt: number;
  scoreCount: number;
  scores: T[];
}> {
  const ordered = [...scores].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
  const sessions: Array<{
    startedAt: number;
    endedAt: number;
    scoreCount: number;
    scores: T[];
  }> = [];
  for (const score of ordered) {
    const last = sessions[sessions.length - 1];
    if (!last || score.playedAt - last.endedAt > SESSION_GAP_MS) {
      sessions.push({
        startedAt: score.playedAt,
        endedAt: score.playedAt,
        scoreCount: 1,
        scores: [score],
      });
      continue;
    }
    last.endedAt = score.playedAt;
    last.scoreCount += 1;
    last.scores.push(score);
  }
  return sessions.reverse();
}
