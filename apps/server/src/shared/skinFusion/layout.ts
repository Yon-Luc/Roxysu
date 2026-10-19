/**
 * Lazer skin layout JSON (`MainHUDComponents.json`, `Playfield.json`,
 * `SongSelect.json`). `DrawableInfo` is keyed by ruleset short name
 * (`global`, `osu`, `taiko`, `fruits`, `mania`, plus custom rulesets such as
 * BMS). Component entries are always copied verbatim; the only edit is the
 * `sprite_name` of sprite components whose file had to be renamed.
 */

export type LayoutEntry = Record<string, unknown>;

export type LayoutDoc = {
  Version?: number;
  DrawableInfo: Record<string, LayoutEntry[]>;
  [key: string]: unknown;
};

/** Layout files composed per ruleset. */
export const COMPOSED_LAYOUT_FILES = ["MainHUDComponents.json", "Playfield.json"] as const;
export const SONG_SELECT_FILE = "SongSelect.json";
export const SKIN_INFO_FILE = "skininfo.json";

export type LayoutSlotKey = "global" | "osu" | "taiko" | "fruits" | "mania" | "bms";

/** Map a `DrawableInfo` key to the slot that owns it. Unknown keys belong to `bms`. */
export function layoutKeySlot(key: string): LayoutSlotKey {
  switch (key.toLowerCase()) {
    case "global":
      return "global";
    case "osu":
      return "osu";
    case "taiko":
      return "taiko";
    case "fruits":
    case "catch":
      return "fruits";
    case "mania":
      return "mania";
    default:
      return "bms";
  }
}

export function parseLayout(bytes: Uint8Array): LayoutDoc | null {
  try {
    const text = new TextDecoder("utf-8").decode(
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes,
    );
    const json = JSON.parse(text) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const info = (json as { DrawableInfo?: unknown }).DrawableInfo;
    if (!info || typeof info !== "object" || Array.isArray(info)) return null;
    const cleaned: Record<string, LayoutEntry[]> = {};
    for (const [key, value] of Object.entries(info as Record<string, unknown>)) {
      if (Array.isArray(value)) cleaned[key] = value as LayoutEntry[];
    }
    return { ...(json as object), DrawableInfo: cleaned } as LayoutDoc;
  } catch {
    return null;
  }
}

function settingsOf(entry: LayoutEntry): Record<string, unknown> | null {
  const s = entry.Settings;
  return s && typeof s === "object" && !Array.isArray(s)
    ? (s as Record<string, unknown>)
    : null;
}

/** Every `sprite_name` referenced by the entries and their children. */
export function collectSpriteNames(entries: LayoutEntry[]): string[] {
  const out = new Set<string>();
  const walk = (list: LayoutEntry[]) => {
    for (const entry of list) {
      const name = settingsOf(entry)?.sprite_name;
      if (typeof name === "string" && name.length > 0) out.add(name);
      const children = entry.Children;
      if (Array.isArray(children)) walk(children as LayoutEntry[]);
    }
  };
  walk(entries);
  return [...out];
}

/** Deep copy of the entries with `sprite_name` values replaced (case-insensitive match). */
export function rewriteSpriteNames(
  entries: LayoutEntry[],
  renames: ReadonlyMap<string, string>,
): LayoutEntry[] {
  const lower = new Map<string, string>();
  for (const [from, to] of renames) lower.set(from.toLowerCase(), to);
  const copy = (list: LayoutEntry[]): LayoutEntry[] =>
    list.map((entry) => {
      const next: LayoutEntry = { ...entry };
      const settings = settingsOf(entry);
      if (settings) {
        const nextSettings = { ...settings };
        const name = nextSettings.sprite_name;
        if (typeof name === "string") {
          const to = lower.get(name.toLowerCase());
          if (to !== undefined) nextSettings.sprite_name = to;
        }
        next.Settings = nextSettings;
      }
      if (Array.isArray(entry.Children)) next.Children = copy(entry.Children as LayoutEntry[]);
      return next;
    });
  return copy(entries);
}

export type LayoutPick = {
  /** Original `DrawableInfo` key. */
  key: string;
  donorId: string;
  entries: LayoutEntry[];
};

/**
 * Choose, per `DrawableInfo` key, which donor's entries to use.
 * `pick(key)` returns the donor id or null to skip the ruleset.
 */
export function pickLayoutEntries(
  docs: ReadonlyMap<string, LayoutDoc | null>,
  pick: (key: string) => string | null,
): LayoutPick[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const doc of docs.values()) {
    if (!doc) continue;
    for (const key of Object.keys(doc.DrawableInfo)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const out: LayoutPick[] = [];
  for (const key of keys) {
    const donorId = pick(key);
    if (!donorId) continue;
    const entries = docs.get(donorId)?.DrawableInfo[key];
    if (!entries) continue;
    out.push({ key, donorId, entries });
  }
  return out;
}

/**
 * Lowest `Version` among the donors that contributed entries. Lazer migrates
 * every layout file from its own `Version` up to the latest on load (v0 -> v1
 * moves combo counters out of `global`), so the lowest version keeps each
 * donor's migrations running and is a no-op for entries that are already current.
 */
export function layoutVersion(
  docs: ReadonlyMap<string, LayoutDoc | null>,
  donorIds: Iterable<string>,
): number {
  let version: number | null = null;
  for (const id of donorIds) {
    const raw = docs.get(id)?.Version;
    const v = typeof raw === "number" ? raw : 1;
    if (version === null || v < version) version = v;
  }
  return version ?? 1;
}

const CORE_RULESET_TYPE_RE = /^osu\.Game\.Rulesets\.(Osu|Taiko|Catch|Mania)\./;

/** Component `Type`s that need a custom ruleset assembly (anything under osu.Game.Rulesets.* except the four built-in rulesets). */
export function customRulesetTypes(entries: LayoutEntry[]): string[] {
  const out = new Set<string>();
  const walk = (list: LayoutEntry[]) => {
    for (const entry of list) {
      const type = entry.Type;
      if (typeof type === "string") {
        const name = type.split(",")[0]!.trim();
        if (name.startsWith("osu.Game.Rulesets.") && !CORE_RULESET_TYPE_RE.test(name)) {
          out.add(name.split(".").slice(0, 4).join("."));
        }
      }
      if (Array.isArray(entry.Children)) walk(entry.Children as LayoutEntry[]);
    }
  };
  walk(entries);
  return [...out];
}

export function serializeLayout(doc: LayoutDoc): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`);
}
