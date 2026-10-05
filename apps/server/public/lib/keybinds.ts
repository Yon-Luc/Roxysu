import { useSyncExternalStore } from "react";
import { KEYMODES, type Keymode } from "./previewSkin";

export type Keybinds = Record<Keymode, string[]>;

const STORAGE_KEY = "roxysu:keybinds";
const EVENT = "roxysu:keybinds";

/** Playback / UI actions in preview, play, and rewatch. */
export const ACTION_KEYBIND_IDS = [
  "playPause",
  "restart",
  "enterPlay",
  "testFromHere",
  "seekBack",
  "seekForward",
  "goStart",
  "previewPoint",
  "stop",
  "fullscreen",
  "scrollDown",
  "scrollUp",
  "rateDown",
  "rateUp",
] as const;

export type ActionKeybindId = (typeof ACTION_KEYBIND_IDS)[number];

/** Up to two `KeyboardEvent.code` values per action. */
export type ActionKeybinds = Record<ActionKeybindId, string[]>;

const ACTION_STORAGE_KEY = "roxysu:action-keybinds";
const ACTION_EVENT = "roxysu:action-keybinds";

const MAX_CODES_PER_ACTION = 2;

/** Sensible osu!-like defaults by keymode (`KeyboardEvent.code`). */
export function defaultKeybindsFor(keys: Keymode): string[] {
  switch (keys) {
    case 4:
      return ["KeyD", "KeyF", "KeyJ", "KeyK"];
    case 6:
      return ["KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL"];
    case 7:
      return ["KeyS", "KeyD", "KeyF", "Space", "KeyJ", "KeyK", "KeyL"];
    case 8:
      return [
        "KeyA",
        "KeyS",
        "KeyD",
        "KeyF",
        "KeyJ",
        "KeyK",
        "KeyL",
        "Semicolon",
      ];
    case 9:
      return [
        "KeyA",
        "KeyS",
        "KeyD",
        "KeyF",
        "Space",
        "KeyJ",
        "KeyK",
        "KeyL",
        "Semicolon",
      ];
    case 10:
      return [
        "KeyA",
        "KeyS",
        "KeyD",
        "KeyF",
        "KeyG",
        "KeyH",
        "KeyJ",
        "KeyK",
        "KeyL",
        "Semicolon",
      ];
  }
}

export function defaultKeybinds(): Keybinds {
  return {
    4: defaultKeybindsFor(4),
    6: defaultKeybindsFor(6),
    7: defaultKeybindsFor(7),
    8: defaultKeybindsFor(8),
    9: defaultKeybindsFor(9),
    10: defaultKeybindsFor(10),
  };
}

function isCode(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length < 64;
}

function parseKeymodeBinds(raw: unknown, keys: Keymode): string[] {
  const defaults = defaultKeybindsFor(keys);
  if (!Array.isArray(raw)) return defaults;
  return Array.from({ length: keys }, (_, i) =>
    isCode(raw[i]) ? raw[i]! : defaults[i]!,
  );
}

function parseKeybinds(raw: string | null): Keybinds {
  const defaults = defaultKeybinds();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next = { ...defaults };
    for (const keys of KEYMODES) {
      next[keys] = parseKeymodeBinds(parsed[String(keys)], keys);
    }
    return next;
  } catch {
    return defaults;
  }
}

let cached: Keybinds | null = null;

function readFromStorage(): Keybinds {
  try {
    return parseKeybinds(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultKeybinds();
  }
}

export function getKeybinds(): Keybinds {
  if (!cached) cached = readFromStorage();
  return cached;
}

export function setKeybinds(binds: Keybinds): void {
  cached = binds;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(binds));
  } catch {
    // ignore quota / private mode
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function resetKeybinds(): void {
  setKeybinds(defaultKeybinds());
}

export function resetKeymodeKeybinds(keys: Keymode): void {
  const binds = getKeybinds();
  setKeybinds({
    ...binds,
    [keys]: defaultKeybindsFor(keys),
  });
}

export function setColumnKeybind(
  keys: Keymode,
  column: number,
  code: string,
): void {
  const binds = getKeybinds();
  const list = [...binds[keys]];
  if (column < 0 || column >= list.length) return;
  list[column] = code;
  setKeybinds({ ...binds, [keys]: list });
}

/** Column index for a key code, or -1 if unbound. */
export function codeToColumn(binds: string[], code: string): number {
  return binds.indexOf(code);
}

/** Resolve binds for an arbitrary column count (nearest supported keymode). */
export function resolveKeybinds(
  all: Keybinds,
  columnCount: number,
): string[] {
  if (KEYMODES.includes(columnCount as Keymode)) {
    return all[columnCount as Keymode];
  }
  let nearest: Keymode = 7;
  let best = Infinity;
  for (const k of KEYMODES) {
    const d = Math.abs(k - columnCount);
    if (d < best) {
      best = d;
      nearest = k;
    }
  }
  const base = all[nearest];
  return Array.from({ length: Math.max(1, columnCount) }, (_, i) =>
    base[i % base.length]!,
  );
}

/** Columns that share the same code within a keymode layout. */
export function findKeybindConflicts(binds: string[]): number[][] {
  const byCode = new Map<string, number[]>();
  for (let i = 0; i < binds.length; i += 1) {
    const code = binds[i]!;
    const list = byCode.get(code) ?? [];
    list.push(i);
    byCode.set(code, list);
  }
  return [...byCode.values()].filter((cols) => cols.length > 1);
}

/** Human-readable label for a `KeyboardEvent.code`. */
export function formatKeyCode(code: string): string {
  if (code === "Space") return "Space";
  if (code === "Enter") return "Enter";
  if (code === "Home") return "Home";
  if (code === "ArrowLeft") return "←";
  if (code === "ArrowRight") return "→";
  if (code === "ArrowUp") return "↑";
  if (code === "ArrowDown") return "↓";
  if (code === "Semicolon") return ";";
  if (code === "Quote") return "'";
  if (code === "Comma") return ",";
  if (code === "Period") return ".";
  if (code === "Slash") return "/";
  if (code === "Backslash") return "\\";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Minus") return "-";
  if (code === "Equal") return "=";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad") && code.length > 6) return `Num${code.slice(6)}`;
  return code;
}

/** Join codes for button titles / footer hints. */
export function formatActionCodes(codes: string[]): string {
  return codes.map(formatKeyCode).join(" / ");
}

export function isModifierOnlyCode(code: string): boolean {
  return (
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "ControlLeft" ||
    code === "ControlRight" ||
    code === "AltLeft" ||
    code === "AltRight" ||
    code === "MetaLeft" ||
    code === "MetaRight" ||
    code === "CapsLock" ||
    code === "Tab" ||
    code === "Escape"
  );
}

/** Defaults matching previous hardcoded preview/rewatch shortcuts. */
export function defaultActionKeybinds(): ActionKeybinds {
  return {
    playPause: ["Space", "KeyK"],
    restart: ["KeyR"],
    enterPlay: ["Enter"],
    testFromHere: ["KeyT"],
    seekBack: ["ArrowLeft", "KeyJ"],
    seekForward: ["ArrowRight", "KeyL"],
    goStart: ["Home", "Digit0"],
    previewPoint: ["KeyP"],
    stop: ["KeyS"],
    fullscreen: ["KeyF"],
    scrollDown: ["BracketLeft"],
    scrollUp: ["BracketRight"],
    rateDown: ["Comma"],
    rateUp: ["Period"],
  };
}

function parseActionCodes(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const codes = raw.filter(isCode).slice(0, MAX_CODES_PER_ACTION);
  return codes.length > 0 ? codes : [...fallback];
}

export function parseActionKeybinds(raw: string | null): ActionKeybinds {
  const defaults = defaultActionKeybinds();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next = { ...defaults };
    for (const id of ACTION_KEYBIND_IDS) {
      next[id] = parseActionCodes(parsed[id], defaults[id]);
    }
    return next;
  } catch {
    return defaults;
  }
}

let actionCached: ActionKeybinds | null = null;

function readActionFromStorage(): ActionKeybinds {
  try {
    return parseActionKeybinds(localStorage.getItem(ACTION_STORAGE_KEY));
  } catch {
    return defaultActionKeybinds();
  }
}

export function getActionKeybinds(): ActionKeybinds {
  if (!actionCached) actionCached = readActionFromStorage();
  return actionCached;
}

export function setActionKeybinds(binds: ActionKeybinds): void {
  actionCached = binds;
  try {
    localStorage.setItem(ACTION_STORAGE_KEY, JSON.stringify(binds));
  } catch {
    // ignore quota / private mode
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ACTION_EVENT));
  }
}

export function resetActionKeybinds(): void {
  setActionKeybinds(defaultActionKeybinds());
}

export function resetActionKeybind(id: ActionKeybindId): void {
  const binds = getActionKeybinds();
  setActionKeybinds({
    ...binds,
    [id]: [...defaultActionKeybinds()[id]],
  });
}

/** Replace all codes for an action (1–2 codes). Empty clears to default. */
export function setActionKeybind(id: ActionKeybindId, codes: string[]): void {
  const cleaned = codes.filter(isCode).slice(0, MAX_CODES_PER_ACTION);
  const next =
    cleaned.length > 0 ? cleaned : [...defaultActionKeybinds()[id]];
  const binds = getActionKeybinds();
  setActionKeybinds({ ...binds, [id]: next });
}

/** Set a single slot (0 or 1). Pass null to remove that slot (keeps the other). */
export function setActionKeybindSlot(
  id: ActionKeybindId,
  slot: 0 | 1,
  code: string | null,
): void {
  const binds = getActionKeybinds();
  const current = [...binds[id]];
  if (code == null || !isCode(code)) {
    if (slot === 0) {
      const rest = current.slice(1);
      setActionKeybinds({
        ...binds,
        [id]: rest.length > 0 ? rest : [...defaultActionKeybinds()[id]],
      });
      return;
    }
    setActionKeybinds({
      ...binds,
      [id]: current.slice(0, 1).length > 0
        ? current.slice(0, 1)
        : [...defaultActionKeybinds()[id]],
    });
    return;
  }
  if (slot === 0) {
    const second = current[1];
    const next = second && second !== code ? [code, second] : [code];
    setActionKeybinds({ ...binds, [id]: next });
    return;
  }
  const first = current[0] ?? defaultActionKeybinds()[id][0]!;
  if (first === code) {
    setActionKeybinds({ ...binds, [id]: [code] });
    return;
  }
  setActionKeybinds({ ...binds, [id]: [first, code] });
}

export function matchesAction(
  binds: ActionKeybinds,
  id: ActionKeybindId,
  code: string,
): boolean {
  return binds[id].includes(code);
}

/** Actions that share the same code (pairs of action ids). */
export function findActionKeybindConflicts(
  binds: ActionKeybinds,
): ActionKeybindId[][] {
  const byCode = new Map<string, ActionKeybindId[]>();
  for (const id of ACTION_KEYBIND_IDS) {
    for (const code of binds[id]) {
      const list = byCode.get(code) ?? [];
      if (!list.includes(id)) list.push(id);
      byCode.set(code, list);
    }
  }
  return [...byCode.values()].filter((ids) => ids.length > 1);
}

/** Action ids whose codes appear in a column layout. */
export function findActionColumnOverlaps(
  actions: ActionKeybinds,
  columns: string[],
): ActionKeybindId[] {
  const colSet = new Set(columns);
  return ACTION_KEYBIND_IDS.filter((id) =>
    actions[id].some((code) => colSet.has(code)),
  );
}

function subscribe(onStoreChange: () => void): () => void {
  function onChange() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) cached = parseKeybinds(raw);
    } catch {
      // keep cache
    }
    onStoreChange();
  }
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onStoreChange);
  };
}

function subscribeActions(onStoreChange: () => void): () => void {
  function onChange() {
    try {
      const raw = localStorage.getItem(ACTION_STORAGE_KEY);
      if (raw) actionCached = parseActionKeybinds(raw);
    } catch {
      // keep cache
    }
    onStoreChange();
  }
  window.addEventListener("storage", onChange);
  window.addEventListener(ACTION_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(ACTION_EVENT, onStoreChange);
  };
}

const serverSnapshot = defaultKeybinds();
const actionServerSnapshot = defaultActionKeybinds();

export function useKeybinds(): Keybinds {
  return useSyncExternalStore(subscribe, getKeybinds, () => serverSnapshot);
}

export function useActionKeybinds(): ActionKeybinds {
  return useSyncExternalStore(
    subscribeActions,
    getActionKeybinds,
    () => actionServerSnapshot,
  );
}
