import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Dictionary } from "@roxysu/i18n";
import {
  AudioLines,
  ChartColumn,
  Clock,
  Download,
  Layers,
  Home,
  LayoutGrid,
  List,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Share2,
  Star,
  Sun,
} from "lucide-react";
import { fetchSystemStatus } from "../lib/api";
import { formatAppVersionLabel } from "../lib/appVersion";
import { isDesktopShell } from "../lib/desktop";
import { useAppDict } from "../lib/i18n";
import { CommandPalette, useCommandPaletteShortcut } from "./CommandPalette";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { DownloadBatchChrome } from "../features/download/DownloadBatchChrome";
import { useMirrorBatchJob } from "../features/download/useMirrorBatchJob";
import { toggleTheme, useResolvedTheme } from "../lib/theme";
import { ToastHost } from "../lib/toasts";
import roxyIcon from "../roxy.png";

const APP_VERSION_LABEL = formatAppVersionLabel();

const SIDEBAR_OPEN_KEY = "roxysu.sidebarOpen";

const ALL_NAV = [
  { to: "/", label: "Home", labelKey: "home", exact: true, icon: Home },
  { to: "/stats", label: "Stats", labelKey: "stats", icon: ChartColumn },
  { to: "/practice", label: "Practice", labelKey: "practice", icon: Clock },
  { to: "/sessions", label: "Sessions", labelKey: "sessions", icon: List },
  { to: "/now-selected", label: "Now selected", labelKey: "nowSelected", icon: AudioLines },
  { to: "/collections", label: "Collections", labelKey: "collections", icon: LayoutGrid },
  { to: "/hub", label: "Community", labelKey: "hub", icon: Share2 },
  { to: "/download-maps", label: "Download", labelKey: "download", icon: Download },
  { to: "/marathon", label: "Marathon", labelKey: "marathon", icon: Layers },
  { to: "/rating-lab", label: "Rating Lab", labelKey: "ratingLab", icon: Star },
  { to: "/skin", label: "Skin", labelKey: "skin", icon: Palette },
  { to: "/settings", label: "Settings", labelKey: "settings", icon: Settings },
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

  const focusLayout = useRouterState({
    select: (s) => {
      if (s.location.pathname !== "/now-selected") return false;
      const search = s.location.search as { focus?: boolean };
      return Boolean(search.focus);
    },
  });

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
    staleTime: 30_000,
    // SSE (sync.finished) handles urgent updates; polling is a safety net only.
    // Double the interval and stop polling when the tab is hidden.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const resolvedTheme = useResolvedTheme();
  const { busy: downloadBusy } = useMirrorBatchJob();
  const onDownloadPage = useRouterState({
    select: (s) => s.location.pathname === "/download-maps",
  });
  const toastOffset =
    downloadBusy && !onDownloadPage
      ? "bottom-44 md:bottom-28"
      : "bottom-20 md:bottom-4";

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
      <DownloadBatchChrome />
      <ToastHost offsetBottomClass={toastOffset} />
      {/* Desktop sidebar */}
      {!focusLayout ? (
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
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="group mb-2 flex items-center gap-3 rounded-md border border-line bg-surface/50 px-3 py-2 text-sm text-muted transition hover:border-border hover:text-ink"
          >
            <Search className="size-4 shrink-0 opacity-70" />
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
              <Moon className="size-4 shrink-0" />
            ) : (
              <Sun className="size-4 shrink-0" />
            )}
            {resolvedTheme === "light"
              ? dict?.common.darkMode ?? "Dark mode"
              : dict?.common.lightMode ?? "Light mode"}
          </button>
          <div
            className={`rx-chip ${
              syncTone === "sky"
                ? "bg-info/15 text-info"
                : syncTone === "amber"
                  ? "bg-warning/15 text-warning"
                  : syncTone === "rose"
                    ? "bg-danger/15 text-danger"
                    : "bg-accent-glow text-accent"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                syncTone === "sky"
                  ? "bg-info"
                  : syncTone === "amber"
                    ? "animate-pulse bg-warning"
                    : syncTone === "rose"
                      ? "bg-danger"
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
      ) : null}

      {/* Reopen control when sidebar is hidden (desktop) */}
      {!focusLayout ? (
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
        <PanelLeftOpen className="size-4" />
      </button>
      ) : null}

      {/* Mobile top brand bar */}
      {!focusLayout ? (
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
              ? "bg-info/15 text-info"
              : syncTone === "amber"
                ? "bg-warning/15 text-warning"
                : syncTone === "rose"
                  ? "bg-danger/15 text-danger"
                  : "bg-accent-glow text-accent"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              syncTone === "sky"
                ? "bg-info"
                : syncTone === "amber"
                  ? "animate-pulse bg-warning"
                  : syncTone === "rose"
                    ? "bg-danger"
                    : "bg-accent"
            }`}
          />
          {syncLabel}
        </span>
      </header>
      ) : null}

      <main
        className={`relative min-h-screen p-0 transition-[margin] duration-200 ease-out md:p-2 ${
          focusLayout
            ? "pb-4 md:ml-0 md:pb-2"
            : `pb-24 md:pb-2 ${sidebarOpen ? "md:ml-60" : "md:ml-0"}`
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
          <div
            className={`page-enter relative mx-auto px-4 py-6 sm:px-6 sm:py-8 ${
              focusLayout ? "max-w-7xl" : "max-w-6xl"
            }`}
          >
            {children}
          </div>
        </div>
      </main>

      {/* Mobile bottom nav */}
      {!focusLayout ? (
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
      ) : null}
    </div>
  );
}
