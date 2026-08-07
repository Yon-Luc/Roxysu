import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Dictionary } from "@roxysu/i18n";
import { fetchSystemStatus } from "../lib/api";
import { formatAppVersionLabel } from "../lib/appVersion";
import { isDesktopShell } from "../lib/desktop";
import { useAppDict } from "../lib/i18n";
import { CommandPalette, useCommandPaletteShortcut } from "./CommandPalette";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { toggleTheme, useResolvedTheme } from "../lib/theme";
import roxyIcon from "../roxy.png";

const APP_VERSION_LABEL = formatAppVersionLabel();

const SIDEBAR_OPEN_KEY = "roxysu.sidebarOpen";

const ALL_NAV = [
  { to: "/", label: "Home", labelKey: "home", exact: true, icon: HomeIcon },
  { to: "/stats", label: "Stats", labelKey: "stats", icon: StatsIcon },
  { to: "/practice", label: "Practice", labelKey: "practice", icon: PracticeIcon },
  { to: "/sessions", label: "Sessions", labelKey: "sessions", icon: SessionsIcon },
  { to: "/collections", label: "Collections", labelKey: "collections", icon: CollectionsIcon },
  { to: "/download-maps", label: "Download", labelKey: "download", icon: DownloadMapsIcon },
  { to: "/rating-lab", label: "Rating Lab", labelKey: "ratingLab", icon: RatingLabIcon },
  { to: "/skin", label: "Skin", labelKey: "skin", icon: SkinIcon },
  { to: "/settings", label: "Settings", labelKey: "settings", icon: SettingsIcon },
] as const;

const DESKTOP_HIDDEN_NAV = new Set(["/rating-lab"]);

function useNavItems(dict: Dictionary["app"] | undefined) {
  return useMemo(() => {
    const items = isDesktopShell()
      ? ALL_NAV.filter((item) => !DESKTOP_HIDDEN_NAV.has(item.to))
      : [...ALL_NAV];
    return items.map((item) => ({
      ...item,
      label: dict?.nav[item.labelKey] ?? item.label,
    }));
  }, [dict]);
}

function readSidebarOpen(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (raw === null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const { dict } = useAppDict();
  const nav = useNavItems(dict);
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const toggleCommandPalette = useCallback(
    () => setCommandPaletteOpen((open) => !open),
    [],
  );

  useCommandPaletteShortcut(toggleCommandPalette);

  function toggleSidebar() {
    setSidebarOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(SIDEBAR_OPEN_KEY, String(next));
      } catch {
        // ignore quota / private mode
      }
      return next;
    });
  }

  const { data: status } = useQuery({
    queryKey: ["system", "status"],
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  });

  const resolvedTheme = useResolvedTheme();

  const importStatus = status?.lastImport?.status;
  const syncTone =
    status?.syncPaused
      ? "sky"
      : importStatus === "running"
        ? "amber"
        : importStatus === "failed"
          ? "rose"
          : "accent";
  const syncLabel =
    status?.syncPaused
      ? dict?.sync.paused ?? "Paused"
      : importStatus === "running"
        ? dict?.sync.syncing ?? "Syncing…"
        : importStatus === "success"
          ? dict?.sync.synced ?? "Synced"
          : importStatus === "failed"
            ? dict?.sync.syncFailed ?? "Sync failed"
            : importStatus === "locked"
              ? dict?.sync.locked ?? "Locked"
              : dict?.sync.noSyncYet ?? "No sync yet";

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar p-3 transition-transform duration-200 ease-out md:flex ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!sidebarOpen}
      >
        <div className="mb-6 flex items-center gap-1 px-1 pt-2">
          <Link
            to="/"
            className="flex min-w-0 flex-1 items-center gap-2.5 px-2 transition hover:opacity-90"
          >
            <img
              src={roxyIcon}
              alt=""
              className="size-8 shrink-0 rounded-full object-cover"
            />
            <span className="min-w-0 leading-tight">
              <span className="block font-display text-xl font-extrabold tracking-tight">
                Roxysu
              </span>
              <span className="block text-[11px] font-medium tracking-wide text-faint">
                {APP_VERSION_LABEL}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-highlight hover:text-ink"
            aria-label={dict?.common.hideMenu ?? "Hide menu"}
            title={dict?.common.hideMenu ?? "Hide menu"}
          >
            <PanelLeftCloseIcon className="size-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="group mb-2 flex items-center gap-3 rounded-md border border-line bg-surface/50 px-3 py-2 text-sm text-muted transition hover:border-border hover:text-ink"
          >
            <SearchIcon className="size-4 shrink-0 opacity-70" />
            <span className="flex-1 text-left">
              {dict?.common.quickSearch ?? "Quick search"}
            </span>
            <kbd className="hidden rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-faint lg:inline">
              ⌃K
            </kbd>
          </button>
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                tabIndex={sidebarOpen ? undefined : -1}
                className="group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold text-muted transition hover:text-ink [&.active]:bg-highlight [&.active]:text-ink"
                {...("exact" in item && item.exact
                  ? { activeOptions: { exact: true } }
                  : {})}
              >
                <Icon className="size-5 shrink-0 opacity-70 transition group-hover:opacity-100 group-[.active]:opacity-100 group-[.active]:text-accent" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 border-t border-line px-2 pt-3">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => toggleTheme()}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-muted transition hover:bg-highlight hover:text-ink"
            title={
              resolvedTheme === "light"
                ? dict?.common.darkMode ?? "Switch to dark theme"
                : dict?.common.lightMode ?? "Switch to light theme"
            }
          >
            {resolvedTheme === "light" ? (
              <MoonIcon className="size-4 shrink-0" />
            ) : (
              <SunIcon className="size-4 shrink-0" />
            )}
            {resolvedTheme === "light"
              ? dict?.common.darkMode ?? "Dark mode"
              : dict?.common.lightMode ?? "Light mode"}
          </button>
          <div
            className={`rx-chip ${
              syncTone === "sky"
                ? "bg-sky-500/15 text-sky-300"
                : syncTone === "amber"
                  ? "bg-amber-500/15 text-amber-300"
                  : syncTone === "rose"
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-accent-glow text-accent"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                syncTone === "sky"
                  ? "bg-sky-400"
                  : syncTone === "amber"
                    ? "animate-pulse bg-amber-400"
                    : syncTone === "rose"
                      ? "bg-rose-400"
                      : "bg-accent"
              }`}
            />
            {syncLabel}
          </div>
          {status ? (
            <p className="px-1 text-[11px] leading-relaxed text-faint">
              {status.scoreCount.toLocaleString()}{" "}
              {dict?.sync.scores ?? "scores"}
              <br />
              {status.beatmapCount.toLocaleString()} {dict?.sync.maps ?? "maps"}
            </p>
          ) : null}
        </div>
      </aside>

      {/* Reopen control when sidebar is hidden (desktop) */}
      <button
        type="button"
        onClick={toggleSidebar}
        className={`fixed left-3 top-3 z-40 hidden size-9 items-center justify-center rounded-md border border-border bg-sidebar/90 text-muted shadow-lg backdrop-blur transition hover:border-line hover:text-ink md:flex ${
          sidebarOpen
            ? "pointer-events-none -translate-x-2 opacity-0"
            : "translate-x-0 opacity-100"
        }`}
        aria-label={dict?.common.showMenu ?? "Show menu"}
        title={dict?.common.showMenu ?? "Show menu"}
        tabIndex={sidebarOpen ? -1 : undefined}
      >
        <PanelLeftOpenIcon className="size-4" />
      </button>

      {/* Mobile top brand bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur-md md:hidden">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={roxyIcon}
            alt=""
            className="size-7 shrink-0 rounded-full object-cover"
          />
          <span className="leading-tight">
            <span className="block font-display text-lg font-extrabold">
              Roxysu
            </span>
            <span className="block text-[10px] font-medium tracking-wide text-faint">
              {APP_VERSION_LABEL}
            </span>
          </span>
        </Link>
        <span
          className={`rx-chip ${
            syncTone === "sky"
              ? "bg-sky-500/15 text-sky-300"
              : syncTone === "amber"
                ? "bg-amber-500/15 text-amber-300"
                : syncTone === "rose"
                  ? "bg-rose-500/15 text-rose-300"
                  : "bg-accent-glow text-accent"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              syncTone === "sky"
                ? "bg-sky-400"
                : syncTone === "amber"
                  ? "animate-pulse bg-amber-400"
                  : syncTone === "rose"
                    ? "bg-rose-400"
                    : "bg-accent"
            }`}
          />
          {syncLabel}
        </span>
      </header>

      <main
        className={`relative min-h-screen p-0 pb-24 transition-[margin] duration-200 ease-out md:p-2 md:pb-2 ${
          sidebarOpen ? "md:ml-60" : "md:ml-0"
        }`}
      >
        <div className="relative min-h-[calc(100vh-0.5rem)] overflow-hidden rounded-none bg-canvas md:min-h-[calc(100vh-1rem)] md:rounded-xl">
          <div
            aria-hidden
            className="ambient-blob pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-64 w-96 rounded-full bg-chart-alt/5 blur-3xl"
          />
          <div className="page-enter relative mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-sidebar/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="group flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold text-faint transition [&.active]:text-ink"
              {...("exact" in item && item.exact
                ? { activeOptions: { exact: true } }
                : {})}
            >
              <Icon className="size-5 opacity-70 transition group-[.active]:text-accent group-[.active]:opacity-100" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" />
    </svg>
  );
}

function PanelLeftCloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M14 9l-3 3 3 3" />
    </svg>
  );
}

function PanelLeftOpenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M11 9l3 3-3 3" />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.97 2.59a1.5 1.5 0 0 0-1.94 0l-7.5 6.56A1.5 1.5 0 0 0 3 10.3V20a1.5 1.5 0 0 0 1.5 1.5H9a.75.75 0 0 0 .75-.75V15.5a1.75 1.75 0 1 1 3.5 0v5.25c0 .41.34.75.75.75h4.5A1.5 1.5 0 0 0 21 20v-9.7a1.5 1.5 0 0 0-.53-1.15l-7.5-6.56Z" />
    </svg>
  );
}

function StatsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4.75 14a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75Zm4.5-5a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-1.5 0v-9.5A.75.75 0 0 1 9.25 9Zm4.5-4a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-1.5 0V5.75a.75.75 0 0 1 .75-.75Zm4.5 7a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5a.75.75 0 0 1 .75-.75Z" />
    </svg>
  );
}

function PracticeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-1.25 5.1a1.25 1.25 0 1 1 2.5 0v3.15l2.35 1.36a1.25 1.25 0 1 1-1.25 2.16l-2.97-1.72A1.25 1.25 0 0 1 10.75 12V8.1Z" />
    </svg>
  );
}

function SessionsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4.5 4.75A.75.75 0 0 1 5.25 4h13.5a.75.75 0 0 1 0 1.5H5.25a.75.75 0 0 1-.75-.75ZM4 9.25c0-.41.34-.75.75-.75h14.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 9.25Zm.75 3.5a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5ZM4 17.75c0-.41.34-.75.75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75Z" />
    </svg>
  );
}

function CollectionsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.75 5.5A1.75 1.75 0 0 1 5.5 3.75h5A1.75 1.75 0 0 1 12.25 5.5v5A1.75 1.75 0 0 1 10.5 12.25h-5A1.75 1.75 0 0 1 3.75 10.5v-5Zm8 0A1.75 1.75 0 0 1 13.5 3.75h5A1.75 1.75 0 0 1 20.25 5.5v5A1.75 1.75 0 0 1 18.5 12.25h-5A1.75 1.75 0 0 1 11.75 10.5v-5ZM3.75 13.5A1.75 1.75 0 0 1 5.5 11.75h5a1.75 1.75 0 0 1 1.75 1.75v5A1.75 1.75 0 0 1 10.5 20.25h-5A1.75 1.75 0 0 1 3.75 18.5v-5Zm8 0a1.75 1.75 0 0 1 1.75-1.75h5a1.75 1.75 0 0 1 1.75 1.75v5a1.75 1.75 0 0 1-1.75 1.75h-5a1.75 1.75 0 0 1-1.75-1.75v-5Z" />
    </svg>
  );
}

function DownloadMapsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3.25a.75.75 0 0 1 .75.75v8.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V4a.75.75 0 0 1 .75-.75ZM4.75 14a.75.75 0 0 1 .75.75v2.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-2.5a.75.75 0 0 1 1.5 0v2.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25v-2.5a.75.75 0 0 1 .75-.75Z" />
    </svg>
  );
}

function RatingLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.25a.75.75 0 0 1 .67.41l1.9 3.84 4.25.62a.75.75 0 0 1 .42 1.28l-3.08 3 0.73 4.24a.75.75 0 0 1-1.09.79L12 15.9l-3.8 2a.75.75 0 0 1-1.08-.79l0.73-4.24-3.08-3a.75.75 0 0 1 .42-1.28l4.25-.62 1.9-3.84A.75.75 0 0 1 12 2.25ZM5.5 18.75A1.75 1.75 0 0 0 3.75 20.5v0.75a.75.75 0 0 0 1.5 0V20.5a.25.25 0 0 1 .25-.25H7.5a.75.75 0 0 0 0-1.5H5.5Zm13 0a.75.75 0 0 0 0 1.5h2a.25.25 0 0 1 .25.25v0.75a.75.75 0 0 0 1.5 0V20.5a1.75 1.75 0 0 0-1.75-1.75H18.5Z" />
    </svg>
  );
}

function SkinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 4.75A.75.75 0 0 1 5.75 4h3.5a.75.75 0 0 1 .75.75v14.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75V4.75Zm9 0a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v14.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75V4.75ZM6.5 7.5h2v2h-2v-2Zm9 3h2v3h-2v-3ZM6.5 12h2v4h-2v-4Z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.07 2.6a1.5 1.5 0 0 1 1.86 0l1.2.96c.28.22.64.3.98.23l1.48-.3a1.5 1.5 0 0 1 1.62.86l.7 1.5c.12.26.35.45.63.53l1.5.4a1.5 1.5 0 0 1 .95 1.95l-.55 1.55a1 1 0 0 0 0 .74l.55 1.55a1.5 1.5 0 0 1-.95 1.95l-1.5.4a1 1 0 0 0-.63.53l-.7 1.5a1.5 1.5 0 0 1-1.62.86l-1.48-.3a1 1 0 0 0-.98.23l-1.2.96a1.5 1.5 0 0 1-1.86 0l-1.2-.96a1 1 0 0 0-.98-.23l-1.48.3a1.5 1.5 0 0 1-1.62-.86l-.7-1.5a1 1 0 0 0-.63-.53l-1.5-.4a1.5 1.5 0 0 1-.95-1.95l.55-1.55a1 1 0 0 0 0-.74l-.55-1.55a1.5 1.5 0 0 1 .95-1.95l1.5-.4a1 1 0 0 0 .63-.53l.7-1.5a1.5 1.5 0 0 1 1.62-.86l1.48.3c.34.07.7-.01.98-.23l1.2-.96ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.166a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5H21a.75.75 0 0 1 .75.75ZM17.834 18.894a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75V21a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM7.758 17.303a.75.75 0 0 0-1.061-1.06l-1.591 1.59a.75.75 0 0 0 1.06 1.061l1.591-1.59ZM6 12a.75.75 0 0 1-.75.75H3a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 6 12ZM4.409 7.757a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591Z" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98 10.503 10.503 0 0 1-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.44-9.726a.75.75 0 0 1 .814.162Z" />
    </svg>
  );
}
