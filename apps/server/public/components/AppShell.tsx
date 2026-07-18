import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchSystemStatus } from "../lib/api";

export function AppShell({ children }: { children: ReactNode }) {
  const { data: status } = useQuery({
    queryKey: ["system", "status"],
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  });

  const importStatus = status?.lastImport?.status;
  const syncLabel =
    importStatus === "running"
      ? "Syncing…"
      : importStatus === "success"
        ? "Synced"
        : importStatus === "failed"
          ? "Sync failed"
          : importStatus === "locked"
            ? "Locked"
            : "No sync yet";

  return (
    <div className="min-h-screen bg-[#0e1015] text-[#e8eaef]">
      <header className="border-b border-white/10 bg-[#12151c]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="text-lg font-semibold tracking-tight text-white">
              Roxysu
            </Link>
            <nav className="flex gap-1 text-sm">
              <Link
                to="/"
                className="rounded-md px-3 py-1.5 text-[#a8b0c0] hover:bg-white/5 hover:text-white [&.active]:bg-white/10 [&.active]:text-white"
                activeOptions={{ exact: true }}
              >
                Dashboard
              </Link>
              <Link
                to="/practice"
                className="rounded-md px-3 py-1.5 text-[#a8b0c0] hover:bg-white/5 hover:text-white [&.active]:bg-white/10 [&.active]:text-white"
              >
                Practice
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#8b93a7]">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                importStatus === "running"
                  ? "bg-amber-500/15 text-amber-300"
                  : importStatus === "failed"
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-emerald-500/10 text-emerald-300"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  importStatus === "running"
                    ? "animate-pulse bg-amber-400"
                    : importStatus === "failed"
                      ? "bg-rose-400"
                      : "bg-emerald-400"
                }`}
              />
              {syncLabel}
            </span>
            {status && (
              <span className="hidden sm:inline">
                {status.scoreCount.toLocaleString()} scores ·{" "}
                {status.beatmapCount.toLocaleString()} maps
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
