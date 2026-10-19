import { useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { useHubUrl } from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";
import { fetchBmsStats, fetchBmsTimeseries } from "./api";
import { BmsCommunityNav } from "./BmsCommunityNav";

export function BmsStatsPage() {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const hubUrl = useHubUrl();
  const stats = useQuery({
    queryKey: ["bms-stats", hubUrl],
    queryFn: () => fetchBmsStats(hubUrl),
  });
  const series = useQuery({
    queryKey: ["bms-timeseries", hubUrl],
    queryFn: () => fetchBmsTimeseries(hubUrl),
  });
  const points = series.data?.series ?? [];
  const max = Math.max(1, ...points.map((point) => point.plays));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <BmsCommunityNav />
      <PageTitle>{copy?.statistics ?? "Statistics"}</PageTitle>
      {stats.error instanceof Error ? <p className="text-sm text-warning">{stats.error.message}</p> : null}
      {stats.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={copy?.uniqueScores ?? "Plays"} value={stats.data.uniqueScores} help={stats.data.definitions.uniqueScores} />
          <Stat
            label={copy?.submissions ?? "Submissions"}
            value={stats.data.recordedSubmissions}
            help={stats.data.definitions.recordedSubmissions}
          />
          <Stat
            label={copy?.activePlayers ?? "Active players"}
            value={stats.data.activePlayers}
            help={stats.data.definitions.activePlayers}
          />
          <Stat label={copy?.rejected ?? "Rejected"} value={stats.data.rejectedSubmissions} help="" />
        </div>
      ) : null}
      <section className="rx-panel p-4">
        <h2 className="font-display text-lg font-semibold">{copy?.activity ?? "Activity"}</h2>
        {series.data?.definition ? <p className="mt-1 text-xs text-muted">{series.data.definition}</p> : null}
        {points.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{copy?.noActivity ?? "No plays in this period."}</p>
        ) : (
          <div className="mt-4 flex h-24 items-end gap-1">
            {points.map((point) => (
              <div
                key={point.day}
                title={`${point.day}: ${point.plays}`}
                className="min-w-1 flex-1 rounded-sm bg-accent"
                style={{ height: `${Math.max(8, (point.plays / max) * 100)}%` }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <section className="rx-panel p-4">
      <div className="font-display text-2xl font-bold tabular-nums text-ink">{value}</div>
      <div className="text-sm text-ink">{label}</div>
      {help ? <p className="mt-2 text-xs text-muted">{help}</p> : null}
    </section>
  );
}
