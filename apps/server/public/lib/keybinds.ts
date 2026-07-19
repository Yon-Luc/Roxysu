import { useSyncExternalStore } from "react";
import { KEYMODES, type Keymode } from "./previewSkin";

export type Keybinds = Record<Keymode, string[]>;

const STORAGE_KEY = "roxysu:keybinds";
const EVENT = "roxysu:keybinds";

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
  window.dispatchEvent(new Event(EVENT));
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

const serverSnapshot = defaultKeybinds();

export function useKeybinds(): Keybinds {
  return useSyncExternalStore(subscribe, getKeybinds, () => serverSnapshot);
}
