import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchSystemStatus } from "../lib/api";

const nav = [
  { to: "/", label: "Home", exact: true, icon: HomeIcon },
  { to: "/practice", label: "Practice", icon: PracticeIcon },
  { to: "/sessions", label: "Sessions", icon: SessionsIcon },
  { to: "/collections", label: "Collections", icon: CollectionsIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: status } = useQuery({
    queryKey: ["system", "status"],
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  });

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
      ? "Paused"
      : importStatus === "running"
        ? "Syncing…"
        : importStatus === "success"
          ? "Synced"
          : importStatus === "failed"
            ? "Sync failed"
            : importStatus === "locked"
              ? "Locked"
              : "No sync yet";

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar p-3 md:flex">
        <Link
          to="/"
          className="mb-6 flex items-center gap-2.5 px-3 pt-2 transition hover:opacity-90"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-black">
            R
          </span>
          <span className="font-display text-xl font-extrabold tracking-tight">
            Roxysu
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
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

        <div className="mt-auto space-y-2 border-t border-white/5 px-2 pt-3">
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
              {status.scoreCount.toLocaleString()} scores
              <br />
              {status.beatmapCount.toLocaleString()} maps
            </p>
          ) : null}
        </div>
      </aside>

      {/* Mobile top brand bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/5 bg-canvas/90 px-4 py-3 backdrop-blur-md md:hidden">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-black">
            R
          </span>
          <span className="font-display text-lg font-extrabold">Roxysu</span>
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

      <main className="relative min-h-screen p-0 pb-24 md:ml-60 md:p-2 md:pb-2">
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
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/5 bg-sidebar/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
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

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.97 2.59a1.5 1.5 0 0 0-1.94 0l-7.5 6.56A1.5 1.5 0 0 0 3 10.3V20a1.5 1.5 0 0 0 1.5 1.5H9a.75.75 0 0 0 .75-.75V15.5a1.75 1.75 0 1 1 3.5 0v5.25c0 .41.34.75.75.75h4.5A1.5 1.5 0 0 0 21 20v-9.7a1.5 1.5 0 0 0-.53-1.15l-7.5-6.56Z" />
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

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.07 2.6a1.5 1.5 0 0 1 1.86 0l1.2.96c.28.22.64.3.98.23l1.48-.3a1.5 1.5 0 0 1 1.62.86l.7 1.5c.12.26.35.45.63.53l1.5.4a1.5 1.5 0 0 1 .95 1.95l-.55 1.55a1 1 0 0 0 0 .74l.55 1.55a1.5 1.5 0 0 1-.95 1.95l-1.5.4a1 1 0 0 0-.63.53l-.7 1.5a1.5 1.5 0 0 1-1.62.86l-1.48-.3a1 1 0 0 0-.98.23l-1.2.96a1.5 1.5 0 0 1-1.86 0l-1.2-.96a1 1 0 0 0-.98-.23l-1.48.3a1.5 1.5 0 0 1-1.62-.86l-.7-1.5a1 1 0 0 0-.63-.53l-1.5-.4a1.5 1.5 0 0 1-.95-1.95l.55-1.55a1 1 0 0 0 0-.74l-.55-1.55a1.5 1.5 0 0 1 .95-1.95l1.5-.4a1 1 0 0 0 .63-.53l.7-1.5a1.5 1.5 0 0 1 1.62-.86l1.48.3c.34.07.7-.01.98-.23l1.2-.96ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
  );
}
