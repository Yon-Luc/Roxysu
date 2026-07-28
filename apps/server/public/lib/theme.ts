import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "roxysu:theme";
const EVENT_NAME = "roxysu:theme";

const OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  description: string;
}> = [
  {
    id: "dark",
    label: "Dark",
    description: "Spotify-style dark interface (default).",
  },
  {
    id: "light",
    label: "Light",
    description: "Bright background with dark text.",
  },
  {
    id: "system",
    label: "System",
    description: "Match your OS light or dark preference.",
  },
];

export function themeOptions() {
  return OPTIONS;
}

function parseMode(raw: string | null): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "dark";
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

export function getTheme(): ThemeMode {
  try {
    return parseMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "dark";
  }
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(getTheme());
}

const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: "#121212",
  light: "#f5f5f5",
};

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle("light", resolved === "light");

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", THEME_COLORS[resolved]);
  }

  return resolved;
}

export function setTheme(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
  window.dispatchEvent(new Event(EVENT_NAME));
}

function subscribe(onStoreChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onMedia = () => {
    if (getTheme() === "system") applyTheme("system");
    onStoreChange();
  };

  window.addEventListener("storage", onStoreChange);
  window.addEventListener(EVENT_NAME, onStoreChange);
  media.addEventListener("change", onMedia);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(EVENT_NAME, onStoreChange);
    media.removeEventListener("change", onMedia);
  };
}

export function useTheme(): ThemeMode {
  return useSyncExternalStore(subscribe, getTheme, () => "dark" as const);
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    getResolvedTheme,
    () => "dark" as const,
  );
}

export function toggleTheme(): void {
  const resolved = getResolvedTheme();
  setTheme(resolved === "light" ? "dark" : "light");
}
