import { useQuery } from "@tanstack/react-query";
import { fetchSessions } from "../../lib/api";
import { formatRelativeTime } from "../../lib/format";

export function SessionsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  if (isLoading) {
    return <p className="text-[#8b93a7]">Loading sessions…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-rose-300">
        Failed to load sessions: {error?.message ?? "unknown"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-[#8b93a7]">
          Automatic play groups (30 min inactivity starts a new session).
        </p>
      </div>

      {data.current ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="text-xs uppercase tracking-wider text-emerald-300">
            Current session
          </div>
          <div className="mt-1 text-white">
            {data.current.scoreCount} plays · started{" "}
            {formatRelativeTime(data.current.startedAt)}
            {data.current.rulesetShortName
              ? ` · ${data.current.rulesetShortName}`
              : ""}
          </div>
        </div>
      ) : null}

      {data.items.length === 0 ? (
        <p className="text-sm text-[#8b93a7]">No sessions yet.</p>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-[#151922]">
          {data.items.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <div className="font-medium text-white">
                  Session #{s.id}
                  {s.endedAt == null ? (
                    <span className="ml-2 text-xs text-emerald-300">open</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-[#8b93a7]">
                  {formatRelativeTime(s.startedAt)}
                  {s.endedAt ? ` → ${formatRelativeTime(s.endedAt)}` : ""}
                  {s.rulesetShortName ? ` · ${s.rulesetShortName}` : ""}
                </div>
              </div>
              <div className="text-sm tabular-nums text-[#a8b0c0]">
                {s.scoreCount} plays
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
