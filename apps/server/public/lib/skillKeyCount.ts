export const SKILL_KEY_COUNT_STORAGE_KEY = "roxysu:skill-key-count";
export const SKILL_KEY_COUNT_DEFAULT = 7;

export function normalizeSkillKeyCount(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 18) return null;
  return rounded;
}

/** Key count from a URL search value, or null when the param was omitted. */
export function skillKeyCountFromSearch(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  return normalizeSkillKeyCount(Number(raw));
}

/** Last Stats keymode the player chose, or null when they have never chosen one. */
export function readStoredSkillKeyCount(): number | null {
  try {
    const raw = localStorage.getItem(SKILL_KEY_COUNT_STORAGE_KEY);
    if (raw == null || raw === "") return null;
    return normalizeSkillKeyCount(Number(raw));
  } catch {
    return null;
  }
}

export function readSkillKeyCount(): number {
  return readStoredSkillKeyCount() ?? SKILL_KEY_COUNT_DEFAULT;
}

export function writeSkillKeyCount(n: number): void {
  const normalized = normalizeSkillKeyCount(n);
  if (normalized == null) return;
  try {
    localStorage.setItem(SKILL_KEY_COUNT_STORAGE_KEY, String(normalized));
  } catch {
    // ignore quota / private mode
  }
}

/** How the current Stats keymode was chosen. Explicit URL wins over storage. */
export function statsKeyCountSource(): "url" | "stored" | "default" {
  if (typeof window === "undefined") return "default";
  const hash = window.location.hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  if (skillKeyCountFromSearch(new URLSearchParams(query).get("keyCount")) != null) {
    return "url";
  }
  if (readStoredSkillKeyCount() != null) return "stored";
  return "default";
}
