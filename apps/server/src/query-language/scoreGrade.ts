/** Mania max score when every hit is Marvelous (ScoreV1-style ceiling). */
export const PERFECT_TOTAL_SCORE = 1_000_000;

export type ScoreGrade = "D" | "C" | "B" | "A" | "S" | "SS" | "X";

const GRADE_ALIASES: Record<string, ScoreGrade> = {
  d: "D",
  c: "C",
  b: "B",
  a: "A",
  s: "S",
  sh: "S",
  ss: "SS",
  xh: "SS",
  x: "X",
};

/** Classify a nomod/mirror mania score into a display / query grade bucket. */
export function classifyScoreGrade(
  totalScore: number,
  rank: number,
): ScoreGrade | null {
  if (rank === -1) return null;
  if (Number(totalScore) === PERFECT_TOTAL_SCORE) return "X";
  if (rank === 6 || rank === 7) return "SS";
  if (rank === 4 || rank === 5) return "S";
  if (rank === 3) return "A";
  if (rank === 2) return "B";
  if (rank === 1) return "C";
  if (rank === 0) return "D";
  return null;
}

export function normalizeScoreGrade(raw: string): ScoreGrade | null {
  const key = raw.trim().toLowerCase();
  return GRADE_ALIASES[key] ?? null;
}

/** Gameplay mods excluded from stats rank buckets (NM / Mirror only). */
const DISALLOWED_MOD_ACRONYMS = [
  "AT",
  "AP",
  "CL",
  "DC",
  "DT",
  "EZ",
  "FI",
  "FL",
  "HD",
  "HR",
  "HT",
  "NC",
  "NF",
  "PF",
  "RX",
  "SD",
  "SO",
  "TP",
  "V2",
] as const;

/** SQL boolean on a scores row alias — true for nomod or Mirror-only scores. */
export function nomodOrMirrorOnlySql(alias: string): string {
  const mods = `${alias}.mods`;
  const disallowed = DISALLOWED_MOD_ACRONYMS.map(
    (acronym) =>
      `${mods} LIKE '%"${acronym}"%' OR ${mods} LIKE '%"${acronym.toLowerCase()}"%'`,
  ).join(" OR ");
  const mirror =
    `${mods} LIKE '%"MR"%' OR ${mods} LIKE '%"mr"%' OR ${mods} LIKE '%["MR"]%' OR ${mods} LIKE '%["mr"]%'`;
  return `(
    ${mods} IS NULL
    OR TRIM(${mods}) IN ('', '[]', '{}')
    OR (NOT (${disallowed}) AND (${mirror}))
  )`;
}

/** SQL expression returning D/C/B/A/S/SS/X for a scores row (null when fail / unknown). */
export function scoreRowGradeSql(alias: string): string {
  const rank = `${alias}.rank`;
  const score = `${alias}.total_score`;
  return `(
    CASE
      WHEN ${score} = ${PERFECT_TOTAL_SCORE} THEN 'X'
      WHEN ${rank} IN (6, 7) THEN 'SS'
      WHEN ${rank} IN (4, 5) THEN 'S'
      WHEN ${rank} = 3 THEN 'A'
      WHEN ${rank} = 2 THEN 'B'
      WHEN ${rank} = 1 THEN 'C'
      WHEN ${rank} = 0 THEN 'D'
      ELSE NULL
    END
  )`;
}
