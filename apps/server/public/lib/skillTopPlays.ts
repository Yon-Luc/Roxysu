export const SKILL_TOP_PLAYS_STORAGE_KEY = "roxysu:skill-top-plays";
export const SKILL_TOP_PLAYS_DEFAULT = 30;

export function normalizeSkillTopPlays(n: number): number {
  if (!Number.isFinite(n)) return SKILL_TOP_PLAYS_DEFAULT;
  return Math.min(500, Math.max(1, Math.round(n)));
}

export function readSkillTopPlays(): number {
  try {
    const raw = localStorage.getItem(SKILL_TOP_PLAYS_STORAGE_KEY);
    if (!raw) return SKILL_TOP_PLAYS_DEFAULT;
    return normalizeSkillTopPlays(Number(raw));
  } catch {
    return SKILL_TOP_PLAYS_DEFAULT;
  }
}

export function writeSkillTopPlays(n: number): void {
  try {
    localStorage.setItem(
      SKILL_TOP_PLAYS_STORAGE_KEY,
      String(normalizeSkillTopPlays(n)),
    );
  } catch {
    // ignore quota / private mode
  }
}
