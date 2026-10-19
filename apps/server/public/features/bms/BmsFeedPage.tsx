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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
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
      <ul className="flex flex-col gap-3">
        {(feed.data?.scores ?? []).map((score) => (
          <li key={score.id} className="rx-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                to="/bms/players/$username"
                params={{ username: score.username }}
                className="font-semibold text-ink"
              >
                {score.username}
              </Link>
              <span className="text-xs text-muted">
                {formatRelativeTime(score.achievedAt, dict?.common)}
              </span>
            </div>
            <Link
              to="/bms/charts/$chartId"
              params={{ chartId: score.chartMd5 }}
              search={{ variant: score.variantId }}
              className="mt-1 block truncate text-sm text-accent"
            >
              {score.artist ? `${score.artist} — ` : ""}
              {score.title ?? score.chartMd5}
            </Link>
            <p className="mt-2 text-sm tabular-nums text-subtle">
              {score.variantId} · {score.djGrade ?? "—"} · {score.exScore ?? "—"} ·{" "}
              {formatAccuracy(score.accuracy)}
            </p>
          </li>
        ))}
      </ul>
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
