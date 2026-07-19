import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { fetchSessions } from "../../lib/api";
import { formatRelativeTime } from "../../lib/format";

export function SessionsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  if (isLoading) {
    return <p className="text-muted">Loading sessions…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-rose-300">
        Failed to load sessions: {error?.message ?? "unknown"}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>Sessions</PageTitle>
        <p className="rx-subtitle">
          Automatic play groups (30 min inactivity starts a new session).
        </p>
      </div>

      {data.current ? (
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: "current" }}
          className="group relative block overflow-hidden rounded-xl bg-gradient-to-br from-accent/20 via-surface to-surface p-5 transition hover:from-accent/30"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                Now playing
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-ink">
                {data.current.scoreCount} plays
              </div>
              <div className="mt-1 text-sm text-muted">
                Started {formatRelativeTime(data.current.startedAt)}
                {data.current.rulesetShortName
                  ? ` · ${data.current.rulesetShortName}`
                  : ""}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-bold text-black transition group-hover:scale-105">
              Open live
            </span>
          </div>
        </Link>
      ) : (
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: "current" }}
          className="group relative block overflow-hidden rounded-xl bg-gradient-to-br from-accent/20 via-surface to-surface p-5 transition hover:from-accent/30"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-accent">
                Ready when you are
              </div>
              <div className="mt-2 font-display text-2xl font-bold text-ink">
                Start a session
              </div>
              <div className="mt-1 text-sm text-muted">
                Get map recommendations, then play to open a live session.
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-bold text-black transition group-hover:scale-105">
              Open
            </span>
          </div>
        </Link>
      )}

      {data.items.length === 0 ? (
        <p className="text-sm text-muted">No sessions yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {data.items.map((s) => {
            const isOpen = s.endedAt == null;
            return (
              <li key={s.id}>
                <Link
                  to="/sessions/$sessionId"
                  params={{
                    sessionId: isOpen ? "current" : String(s.id),
                  }}
                  className="rx-row justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">
                      {isOpen ? "Current session" : `Session #${s.id}`}
                      {isOpen ? (
                        <span className="ml-2 text-xs font-bold text-accent">
                          live
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-sm text-muted">
                      {formatRelativeTime(s.startedAt)}
                      {s.endedAt ? ` → ${formatRelativeTime(s.endedAt)}` : ""}
                      {s.rulesetShortName ? ` · ${s.rulesetShortName}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums text-subtle">
                    {s.scoreCount} plays
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
