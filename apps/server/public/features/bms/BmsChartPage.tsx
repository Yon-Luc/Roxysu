import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { formatAccuracy } from "../../lib/format";
import { useHubUrl } from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";
import { fetchBmsChart, fetchBmsLeaderboard } from "./api";
import { BmsCommunityNav } from "./BmsCommunityNav";
import { BMS_ACHIEVEMENTS, BMS_GAUGES } from "./types";

export type BmsChartSearch = {
  variant?: string;
  achievement?: string;
  gauge?: string;
  country?: string;
  cursor?: string;
};

export function BmsChartPage({
  chartId,
  search,
  onSearch,
}: {
  chartId: string;
  search: BmsChartSearch;
  onSearch: (next: BmsChartSearch) => void;
}) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const hubUrl = useHubUrl();
  const chart = useQuery({
    queryKey: ["bms-chart", hubUrl, chartId],
    queryFn: () => fetchBmsChart(hubUrl, chartId),
  });
  const variant = search.variant ?? "";
  const board = useQuery({
    queryKey: ["bms-leaderboard", hubUrl, chartId, search],
    queryFn: () =>
      fetchBmsLeaderboard(hubUrl, chartId, {
        variant,
        achievement: search.achievement,
        gauge: search.gauge,
        country: search.country,
        cursor: search.cursor,
      }),
    enabled: variant.length > 0 && chart.isSuccess,
  });

  function setFilter(patch: BmsChartSearch) {
    onSearch({ ...search, ...patch, cursor: undefined });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <BmsCommunityNav />
      <div>
        <PageTitle>{chart.data?.title ?? copy?.chart ?? "Chart"}</PageTitle>
        <p className="mt-1 text-sm text-muted">
          {chart.data?.artist ?? ""}
          {chart.data?.keyCount ? ` · ${chart.data.keyCount}K` : ""}
        </p>
      </div>
      {chart.error instanceof Error ? (
        <p className="text-sm text-warning">{chart.error.message}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {(chart.data?.variants ?? []).map((item) => (
          <button
            key={item.variantId}
            type="button"
            className={`rx-chip transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] ${
              item.variantId === variant ? "bg-accent text-white" : "bg-elevated text-muted hover:text-ink"
            }`}
            onClick={() => setFilter({ variant: item.variantId })}
          >
            {item.variantId}
            <span className="tabular-nums opacity-80">{item.players}</span>
          </button>
        ))}
      </div>
      {variant ? (
        <form
          key={`${search.achievement ?? ""}-${search.gauge ?? ""}-${search.country ?? ""}`}
          className="grid gap-3 rounded-lg bg-surface p-4 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setFilter({
              achievement: String(data.get("achievement") ?? "") || undefined,
              gauge: String(data.get("gauge") ?? "") || undefined,
              country: String(data.get("country") ?? "")
                .trim()
                .toUpperCase() || undefined,
            });
          }}
        >
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
            {copy?.achievement ?? "Achievement"}
            <select className="rx-select" name="achievement" defaultValue={search.achievement ?? ""}>
              <option value="">{copy?.any ?? "Any"}</option>
              {BMS_ACHIEVEMENTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
            {copy?.gauge ?? "Gauge"}
            <select className="rx-select" name="gauge" defaultValue={search.gauge ?? ""}>
              <option value="">{copy?.any ?? "Any"}</option>
              {BMS_GAUGES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
            {copy?.country ?? "Country"}
            <input
              className="rx-input w-full uppercase"
              name="country"
              maxLength={2}
              defaultValue={search.country ?? ""}
            />
          </label>
          <button type="submit" className="rx-btn">
            {copy?.apply ?? "Apply"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">{copy?.pickVariant ?? "Choose a variant to open the leaderboard."}</p>
      )}
      {board.error instanceof Error ? (
        <p className="text-sm text-warning">{board.error.message}</p>
      ) : null}
      {board.data ? (
        <section className="rx-panel p-4">
          <h2 className="font-display text-lg font-semibold">{copy?.leaderboard ?? "Leaderboard"}</h2>
          {board.data.scores.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
          ) : (
            <ol className="mt-3">
              {board.data.scores.map((row) => (
                <li
                  key={row.id}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line py-2.5 text-sm last:border-b-0 sm:grid-cols-[2rem_minmax(0,1fr)_auto]"
                >
                  <span className="tabular-nums text-faint">{row.rank}</span>
                  <Link
                    to="/bms/players/$username"
                    params={{ username: row.username }}
                    className="min-w-0 truncate font-semibold text-ink"
                  >
                    {row.username}
                    {row.countryCode ? <span className="ml-2 font-normal text-muted">{row.countryCode}</span> : null}
                  </Link>
                  <span className="col-start-2 tabular-nums text-muted sm:col-start-auto">
                    {row.djGrade ?? "—"} · {row.exScore ?? "—"} · {formatAccuracy(row.accuracy)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {board.data.nextCursor ? (
            <button
              type="button"
              className="rx-btn mt-4"
              onClick={() => onSearch({ ...search, cursor: board.data.nextCursor ?? undefined })}
            >
              {copy?.more ?? "More"}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
