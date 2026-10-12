const HIT_ORDER = ["miss", "meh", "ok", "good", "great", "perfect"] as const;

const PASCAL: Record<string, string> = {
  miss: "Miss",
  meh: "Meh",
  ok: "Ok",
  good: "Good",
  great: "Great",
  perfect: "Perfect",
};

const ENUM_INT: Record<string, number> = {
  miss: 1,
  meh: 2,
  ok: 3,
  good: 4,
  great: 5,
  perfect: 6,
};

export type RealmStatStyle = "pascal" | "lower" | "int";

export function detectRealmStatStyle(sample: string | null | undefined): RealmStatStyle {
  if (!sample) return "pascal";
  if (/"\d+"\s*:/.test(sample)) return "int";
  if (/"miss"|"great"|"perfect"/i.test(sample) && /"miss"|"great"/.test(sample)) {
    return sample.includes('"Miss"') || sample.includes('"Great"') ? "pascal" : "lower";
  }
  if (sample.includes('"Miss"') || sample.includes('"Great"') || sample.includes('"Perfect"')) {
    return "pascal";
  }
  return "pascal";
}

export function realmStatisticsJson(
  stats: Record<string, number>,
  style: RealmStatStyle,
): string {
  const out: Record<string, number> = {};
  for (const key of HIT_ORDER) {
    const value = stats[key] ?? 0;
    if (value <= 0) continue;
    if (style === "int") out[String(ENUM_INT[key])] = value;
    else if (style === "lower") out[key] = value;
    else out[PASCAL[key]!] = value;
  }
  if (Object.keys(out).length === 0) {
    const key = style === "int" ? "6" : style === "lower" ? "perfect" : "Perfect";
    out[key] = 1;
  }
  return JSON.stringify(out);
}

export function maximumStatisticsJson(
  achieved: Record<string, number>,
  maximum: Record<string, number> | null,
  objectCount: number,
  style: RealmStatStyle,
): string {
  if (maximum && Object.values(maximum).some((n) => n > 0)) {
    return realmStatisticsJson(maximum, style);
  }
  const top = objectCount > 0 ? objectCount : Math.max(1, ...Object.values(achieved), 1);
  return realmStatisticsJson({ perfect: top }, style);
}
