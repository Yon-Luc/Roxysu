import { useSyncExternalStore } from "react";
import { checkLanguage } from "@roxysu/i18n";
import type { Locale } from "@roxysu/i18n";

const STORAGE_KEY = "roxysu:language";
const EVENT_NAME = "roxysu:language";

function detectLanguage(): Locale {
  try {
    return checkLanguage(navigator.language.split("-")[0]);
  } catch {
    return checkLanguage(undefined);
  }
}

export function getLanguage(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return checkLanguage(saved);
  } catch {
    // ignore quota / private mode
  }
  return detectLanguage();
}

export function setLanguage(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  window.dispatchEvent(new Event(EVENT_NAME));
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(EVENT_NAME, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(EVENT_NAME, onStoreChange);
  };
}

export function useLanguage(): Locale {
  return useSyncExternalStore(subscribe, getLanguage, () => "en" as const);
}
