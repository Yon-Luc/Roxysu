import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "./BeatmapCover";
import {
  fetchCollections,
  fetchSearch,
  fetchSessions,
} from "../lib/api";
import { isDesktopShell } from "../lib/desktop";
import { formatRelativeTime, formatStars } from "../lib/format";
import {
  searchablePageSections,
  type PageSectionDef,
} from "../lib/pageSections";
import { useAppDict, t } from "../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";

const PRACTICE_SEARCH_KEY = "roxysu:practice-search";

const PAGE_LABEL_KEYS: Record<string, keyof Dictionary["app"]["nav"]> = {
  "/": "home",
  "/stats": "stats",
  "/practice": "practice",
  "/sessions": "sessions",
  "/collections": "collections",
  "/hub": "hub",
  "/download-maps": "download",
  "/rating-lab": "ratingLab",
  "/skin": "skin",
  "/settings": "settings",
};

const SETTINGS_SECTION_KEYS: Record<string, keyof Dictionary["app"]["settings"]> =
  {
    "osu-lazer-data-folder": "lazerDataFolder",
    "tosu-live-map": "tosuLiveMap",
    "mastery-formula": "masteryFormula",
    "score-username": "scoreUsername",
    gamemode: "gamemode",
    "live-sync": "liveSync",
    appearance: "appearance",
    "difficulty-display": "difficultyDisplay",
    "preview-skin": "previewSkin",
    keybinds: "keybinds",
    "mania-rating-lab": "maniaRatingLab",
    "sunny-dan-calculation": "sunnyDan",
    "daniel-dan-calculation": "danielDan",
    "pattern-analysis": "patternAnalysis",
  };

const SKIN_SECTION_KEYS: Record<string, keyof Dictionary["app"]["skin"]> = {
  "note-shape": "noteShape",
  "long-notes": "longNotes",
  playfield: "playfield",
  columns: "columns",
  "live-preview": "livePreview",
};

function sectionLabels(
  dict: Dictionary["app"] | undefined,
  section: PageSectionDef,
): { label: string; pageLabel: string } {
  const settingsKey = SETTINGS_SECTION_KEYS[section.id];
  const skinKey = SKIN_SECTION_KEYS[section.id];
  if (settingsKey) {
    return {
      label: (dict?.settings[settingsKey] as string | undefined) ??
        section.label,
      pageLabel: dict?.nav.settings ?? section.pageLabel,
    };
  }
  if (skinKey) {
    return {
      label: (dict?.skin[skinKey] as string | undefined) ?? section.label,
      pageLabel: dict?.nav.skin ?? section.pageLabel,
    };
  }
  return { label: section.label, pageLabel: section.pageLabel };
}

type CommandGroup =
  | "Pages"
  | "Sections"
  | "Actions"
  | "Maps"
  | "Sessions"
  | "Collections";

type CommandItem = {
  id: string;
  group: CommandGroup;
  label: string;
  subtitle?: string;
  hint?: string;
  icon?: ReactNode;
  onSelect: () => void;
};

const ALL_PAGE_ITEMS: {
  to: string;
  label: string;
  keywords?: string[];
}[] = [
  { to: "/", label: "Home", keywords: ["dashboard"] },
  { to: "/stats", label: "Stats", keywords: ["statistics", "analytics"] },
  { to: "/practice", label: "Practice", keywords: ["maps", "library", "beatmaps"] },
  { to: "/sessions", label: "Sessions", keywords: ["plays", "live"] },
  { to: "/collections", label: "Collections", keywords: ["queries"] },
  { to: "/hub", label: "Workshop", keywords: ["hub", "share", "osu", "oauth", "packs", "collections"] },
  {
    to: "/download-maps",
    label: "Download",
    keywords: ["mirrors", "online", "search maps"],
  },
  { to: "/rating-lab", label: "Rating Lab", keywords: ["pp", "mania"] },
  { to: "/skin", label: "Skin", keywords: ["preview", "keybinds"] },
  { to: "/settings", label: "Settings", keywords: ["config", "preferences"] },
];

const DESKTOP_HIDDEN_PAGES = new Set(["/rating-lab"]);

function pageItems() {
  if (!isDesktopShell()) return ALL_PAGE_ITEMS;
  return ALL_PAGE_ITEMS.filter((item) => !DESKTOP_HIDDEN_PAGES.has(item.to));
}

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

function itemMatches(item: { label: string; keywords?: string[] }, query: string) {
  if (!query) return true;
  if (matchesQuery(item.label, query)) return true;
  return item.keywords?.some((keyword) => matchesQuery(keyword, query)) ?? false;
}

function setPracticeSearchQuery(q: string) {
  try {
    const raw = localStorage.getItem(PRACTICE_SEARCH_KEY);
    const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(
      PRACTICE_SEARCH_KEY,
      JSON.stringify({ ...prev, q, page: 1 }),
    );
  } catch {
    localStorage.setItem(
      PRACTICE_SEARCH_KEY,
      JSON.stringify({ q, page: 1, sortBy: "lastPlayed", sortDir: "desc", metric: "accuracy" }),
    );
  }
}

function MapResultIcon({
  backgroundFileHash,
  setOnlineId,
}: {
  backgroundFileHash?: string | null;
  setOnlineId?: number | null;
}) {
  return (
    <BeatmapCover
      backgroundFileHash={backgroundFileHash}
      setOnlineId={setOnlineId}
      size="cover"
      className="size-9 shrink-0 rounded-md object-cover"
      alt=""
    />
  );
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { dict } = useAppDict();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const go = useCallback(
    (
      to: string,
      options?: {
        params?: Record<string, string>;
        search?: Record<string, string | undefined>;
      },
    ) => {
      close();
      setQuery("");
      void navigate({
        to,
        ...(options?.params ? { params: options.params } : {}),
        ...(options?.search ? { search: options.search } : {}),
      } as Parameters<typeof navigate>[0]);
    },
    [close, navigate],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setSelectedIndex(0);
      return;
    }
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
    enabled: open,
    staleTime: 60_000,
  });

  const { data: collectionsData } = useQuery({
    queryKey: ["collections"],
    queryFn: fetchCollections,
    enabled: open,
    staleTime: 60_000,
  });

  const { data: mapResults, isFetching: mapsLoading } = useQuery({
    queryKey: ["command-palette", "search", debouncedQuery],
    queryFn: () => fetchSearch({ q: debouncedQuery, pageSize: 8 }),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const trimmed = query.trim();
    const result: CommandItem[] = [];

    for (const page of pageItems()) {
      if (!itemMatches(page, trimmed)) continue;
      const clearsSection = page.to === "/settings" || page.to === "/skin";
      result.push({
        id: `page:${page.to}`,
        group: "Pages",
        label: dict?.nav[PAGE_LABEL_KEYS[page.to]] ?? page.label,
        subtitle: dict?.command.goToPage,
        onSelect: () =>
          go(
            page.to,
            clearsSection ? { search: { section: undefined } } : undefined,
          ),
      });
    }

    if (trimmed) {
      for (const section of searchablePageSections()) {
        if (!itemMatches(section, trimmed)) continue;
        const { label, pageLabel } = sectionLabels(dict, section);
        result.push({
          id: `section:${section.to}:${section.id}`,
          group: "Sections",
          label,
          subtitle: pageLabel,
          onSelect: () =>
            go(section.to, { search: { section: section.id } }),
        });
      }
    }

    const sessionKeywords = [
      dict?.command.currentSession,
      "current session",
      "live session",
    ].filter((k): k is string => Boolean(k));
    if (
      !trimmed ||
      sessionKeywords.some((keyword) => matchesQuery(keyword, trimmed))
    ) {
      result.push({
        id: "action:current-session",
        group: "Actions",
        label: dict?.command.currentSession ?? "Current session",
        subtitle: sessionsData?.current
          ? `${t(dict?.command.playsCount, {
              count: sessionsData.current.scoreCount,
            })} · ${formatRelativeTime(sessionsData.current.startedAt)}`
          : dict?.command.openLiveSession,
        onSelect: () =>
          go("/sessions/$sessionId", { params: { sessionId: "current" } }),
      });
    }

    if (trimmed) {
      result.push({
        id: "action:practice-search",
        group: "Actions",
        label: t(dict?.command.searchPractice, { query: trimmed }),
        subtitle: dict?.command.searchPracticeSubtitle,
        onSelect: () => {
          setPracticeSearchQuery(trimmed);
          go("/practice");
        },
      });
    }

    if (trimmed && sessionsData) {
      for (const session of sessionsData.items) {
        const label =
          session.endedAt == null
            ? dict?.command.currentSession ?? "Current session"
            : t(dict?.command.sessionLabel, { id: session.id });
        const haystack = [
          label,
          session.rulesetShortName ?? "",
          String(session.scoreCount),
        ].join(" ");
        if (!matchesQuery(haystack, trimmed)) continue;
        result.push({
          id: `session:${session.id}`,
          group: "Sessions",
          label,
          subtitle: `${t(dict?.command.playsCount, {
            count: session.scoreCount,
          })} · ${formatRelativeTime(session.startedAt)}`,
          hint: session.endedAt == null ? dict?.command.live : undefined,
          onSelect: () =>
            go("/sessions/$sessionId", {
              params: {
                sessionId: session.endedAt == null ? "current" : String(session.id),
              },
            }),
        });
      }
    }

    if (trimmed && collectionsData) {
      for (const collection of collectionsData.items) {
        if (collection.kind !== "smart") continue;
        const haystack = [collection.name, collection.query].join(" ");
        if (!matchesQuery(haystack, trimmed)) continue;
        result.push({
          id: `collection:${collection.id}`,
          group: "Collections",
          label: collection.name,
          subtitle: collection.query,
          onSelect: () =>
            go("/collections/$collectionId", {
              params: { collectionId: String(collection.id) },
            }),
        });
      }
    }

    if (debouncedQuery && mapResults?.items) {
      for (const map of mapResults.items) {
        if (!map.id) continue;
        result.push({
          id: `map:${map.id}`,
          group: "Maps",
          label: map.title ?? dict?.command.unknownMap ?? "Unknown map",
          subtitle: `${map.artist ?? dict?.command.unknownArtist ?? "Unknown artist"} · ${map.difficultyName ?? dict?.command.unknownDifficulty ?? "Unknown"} · ${formatStars(map.starRating)}`,
          icon: (
            <MapResultIcon
              backgroundFileHash={map.backgroundFileHash}
              setOnlineId={map.setOnlineId}
            />
          ),
          onSelect: () =>
            go("/practice/$beatmapId", { params: { beatmapId: map.id! } }),
        });
      }
    }

    return result;
  }, [
    query,
    debouncedQuery,
    mapResults,
    sessionsData,
    collectionsData,
    go,
    dict,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, debouncedQuery, items.length]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) =>
          items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
        );
        return;
      }
      if (e.key === "Enter" && items[selectedIndex]) {
        e.preventDefault();
        items[selectedIndex].onSelect();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close, items, selectedIndex]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector("[data-active=true]");
    active?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  if (!open) return null;

  const grouped = (
    ["Pages", "Sections", "Actions", "Maps", "Sessions", "Collections"] as const
  )
    .map((group) => ({
      group,
      items: items.filter((item) => item.group === group),
    }))
    .filter((section) => section.items.length > 0);

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 pt-[min(20vh,8rem)]"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-elevated shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-4 py-3">
          <label htmlFor={titleId} className="sr-only">
            {dict?.common.quickSearch}
          </label>
          <div className="flex items-center gap-3">
            <SearchIcon className="size-5 shrink-0 text-faint" />
            <input
              ref={inputRef}
              id={titleId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={dict?.command.placeholder}
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="hidden rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-faint sm:inline">
              esc
            </kbd>
          </div>
        </div>

        <div ref={listRef} className="max-h-[min(60vh,24rem)] overflow-y-auto p-2">
          {grouped.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              {mapsLoading ? dict?.command.searching : dict?.command.noResults}
            </p>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="mb-2 last:mb-0">
                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-faint">
                  {dict?.command.groups[section.group] ?? section.group}
                </div>
                <ul>
                  {section.items.map((item) => {
                    const index = runningIndex++;
                    const active = index === selectedIndex;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-active={active}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                            active ? "bg-accent/15 text-ink" : "text-muted hover:bg-highlight hover:text-ink"
                          }`}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onClick={item.onSelect}
                        >
                          {item.icon ?? (
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-xs font-bold text-faint">
                              {section.group === "Pages"
                                ? "→"
                                : section.group === "Sections"
                                  ? "§"
                                  : section.group === "Actions"
                                    ? "⚡"
                                    : section.group === "Sessions"
                                      ? "▤"
                                      : section.group === "Collections"
                                        ? "▦"
                                        : "♫"}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-semibold text-ink">{item.label}</span>
                              {item.hint ? (
                                <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                                  {item.hint}
                                </span>
                              ) : null}
                            </span>
                            {item.subtitle ? (
                              <span className="mt-0.5 block truncate text-sm text-muted">
                                {item.subtitle}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          {mapsLoading && debouncedQuery && grouped.every((s) => s.group !== "Maps") ? (
            <p className="px-3 py-2 text-center text-xs text-faint">{dict?.command.searching}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span>{dict?.command.footerHint}</span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5">↑↓</kbd> {dict?.command.navigate}{" "}
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5">↵</kbd> {dict?.command.open}
          </span>
        </div>
      </div>
    </div>
  );
}

export function useCommandPaletteShortcut(onToggle: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      onToggle();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onToggle]);
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" />
    </svg>
  );
}
