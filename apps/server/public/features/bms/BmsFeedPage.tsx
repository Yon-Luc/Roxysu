import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { formatAccuracy, formatRelativeTime } from "../../lib/format";
import { useHubUrl } from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";
import { fetchBmsFeed } from "./api";
import { BmsCommunityNav } from "./BmsCommunityNav";

export function BmsFeedPage({
  cursor,
  onCursor,
}: {
  cursor?: string;
  onCursor: (cursor: string | undefined) => void;
}) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const hubUrl = useHubUrl();
  const feed = useQuery({
    queryKey: ["bms-feed", hubUrl, cursor ?? null],
    queryFn: () => fetchBmsFeed(hubUrl, cursor ?? null),
    refetchInterval: cursor ? false : 20_000,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <BmsCommunityNav />
      <div>
        <PageTitle>{copy?.feed ?? "Feed"}</PageTitle>
        <p className="mt-1 text-sm text-muted">
          {copy?.feedHelp ?? "Recent public scores. A retry of a score already stored does not appear again."}
        </p>
      </div>
      {feed.error instanceof Error ? <p className="text-sm text-warning">{feed.error.message}</p> : null}
      {feed.data && feed.data.scores.length === 0 ? (
        <p className="text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
      ) : null}
      {feed.data && feed.data.scores.length > 0 ? (
      <ul className="overflow-hidden rounded-lg bg-surface">
        {feed.data.scores.map((score) => (
          <li
            key={score.id}
            className="grid gap-1 border-b border-line px-3 py-3 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
          >
            <Link
              to="/bms/players/$username"
              params={{ username: score.username }}
              className="truncate text-sm font-semibold text-ink"
            >
              {score.username}
            </Link>
            <Link
              to="/bms/charts/$chartId"
              params={{ chartId: score.chartMd5 }}
              search={{ variant: score.variantId }}
              className="min-w-0 truncate text-sm text-ink hover:text-accent"
            >
              {score.title ?? score.chartMd5}
              {score.artist ? <span className="text-muted"> · {score.artist}</span> : null}
            </Link>
            <span className="text-xs tabular-nums text-muted">
              {score.djGrade ?? "—"} · {score.exScore ?? "—"} · {formatAccuracy(score.accuracy)} ·{" "}
              {formatRelativeTime(score.achievedAt, dict?.common)}
            </span>
          </li>
        ))}
      </ul>
      ) : null}
      <div className="flex gap-2">
        {cursor ? (
          <button type="button" className="rx-btn" onClick={() => onCursor(undefined)}>
            {copy?.newer ?? "Newer"}
          </button>
        ) : null}
        {feed.data?.nextCursor ? (
          <button type="button" className="rx-btn" onClick={() => onCursor(feed.data?.nextCursor ?? undefined)}>
            {copy?.more ?? "More"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
