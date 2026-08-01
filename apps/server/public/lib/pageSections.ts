import { useEffect } from "react";
import { isDesktopShell } from "./desktop";

export type PageSectionDef = {
  id: string;
  to: "/settings" | "/skin";
  pageLabel: string;
  label: string;
  keywords?: string[];
  /** Hide in desktop shell (e.g. Rating Lab tools). */
  desktopHidden?: boolean;
};

/** Stable section ids used in URLs (`?section=…`) and DOM (`section-*`). */
export const PAGE_SECTIONS: PageSectionDef[] = [
  {
    id: "osu-lazer-data-folder",
    to: "/settings",
    pageLabel: "Settings",
    label: "osu!lazer data folder",
    keywords: ["settings", "realm", "osu path", "data path", "client.realm"],
  },
  {
    id: "tosu-live-map",
    to: "/settings",
    pageLabel: "Settings",
    label: "Tosu / live map",
    keywords: ["settings", "tosu", "websocket", "live map", "adapter"],
  },
  {
    id: "mastery-formula",
    to: "/settings",
    pageLabel: "Settings",
    label: "Mastery formula",
    keywords: ["settings", "mastery", "level", "formula"],
  },
  {
    id: "score-username",
    to: "/settings",
    pageLabel: "Settings",
    label: "Score username",
    keywords: [
      "settings",
      "scores",
      "username",
      "replay",
      "downloaded",
      "filter",
      "player",
    ],
  },
  {
    id: "live-sync",
    to: "/settings",
    pageLabel: "Settings",
    label: "Live sync",
    keywords: ["settings", "sync", "realm", "pause", "unfocused"],
  },
  {
    id: "appearance",
    to: "/settings",
    pageLabel: "Settings",
    label: "Appearance",
    keywords: ["settings", "theme", "dark", "light", "system"],
  },
  {
    id: "difficulty-display",
    to: "/settings",
    pageLabel: "Settings",
    label: "Difficulty display",
    keywords: ["settings", "stars", "rating", "sunny", "display"],
  },
  {
    id: "preview-skin",
    to: "/settings",
    pageLabel: "Settings",
    label: "Preview skin",
    keywords: ["settings", "skin", "editor", "notes"],
  },
  {
    id: "keybinds",
    to: "/settings",
    pageLabel: "Settings",
    label: "Keybinds",
    keywords: ["settings", "keys", "keyboard", "keymode"],
  },
  {
    id: "mania-rating-lab",
    to: "/settings",
    pageLabel: "Settings",
    label: "Mania Rating Lab",
    keywords: ["settings", "pp", "sr", "calculator", "rating lab"],
    desktopHidden: true,
  },
  {
    id: "sunny-dan-calculation",
    to: "/settings",
    pageLabel: "Settings",
    label: "Sunny dan calculation",
    keywords: ["settings", "sunny", "dan", "labels", "compute"],
  },
  {
    id: "pattern-analysis",
    to: "/settings",
    pageLabel: "Settings",
    label: "7K pattern analysis",
    keywords: ["settings", "7k", "patterns", "chordjack", "bracket"],
  },
  {
    id: "note-shape",
    to: "/skin",
    pageLabel: "Skin",
    label: "Note shape",
    keywords: ["skin", "notes", "arrows", "circles"],
  },
  {
    id: "long-notes",
    to: "/skin",
    pageLabel: "Skin",
    label: "Long notes",
    keywords: ["skin", "ln", "holds", "tail"],
  },
  {
    id: "playfield",
    to: "/skin",
    pageLabel: "Skin",
    label: "Playfield",
    keywords: ["skin", "hit position", "lane cover", "scroll"],
  },
  {
    id: "columns",
    to: "/skin",
    pageLabel: "Skin",
    label: "Columns",
    keywords: ["skin", "lanes", "colors", "keymode"],
  },
  {
    id: "live-preview",
    to: "/skin",
    pageLabel: "Skin",
    label: "Live preview",
    keywords: ["skin", "preview", "notefield"],
  },
];

export function pageSectionDomId(sectionId: string): string {
  return `section-${sectionId}`;
}

export function searchablePageSections(): PageSectionDef[] {
  if (!isDesktopShell()) return PAGE_SECTIONS;
  return PAGE_SECTIONS.filter((s) => !s.desktopHidden);
}

/** Scroll a page section into view when `section` search param is set. */
export function useScrollToPageSection(
  section: string | undefined,
  options?: { ready?: boolean },
) {
  const ready = options?.ready ?? true;

  useEffect(() => {
    if (!section || !ready) return;

    let highlightTimer = 0;
    const scrollTimer = window.setTimeout(() => {
      const el = document.getElementById(pageSectionDomId(section));
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.style.outline = "2px solid var(--color-accent)";
      el.style.outlineOffset = "4px";
      highlightTimer = window.setTimeout(() => {
        el.style.outline = "";
        el.style.outlineOffset = "";
      }, 1600);
    }, 50);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(highlightTimer);
    };
  }, [section, ready]);
}
