import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BeatmapCover } from "../../components/BeatmapCover";
import { CardGridSkeleton, ListSkeleton, SkeletonBlock } from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { formatAccuracy, formatRelativeTime } from "../../lib/format";
import { useAppDict } from "../../lib/i18n";
import { BmsCommunityNav } from "./BmsCommunityNav";
import { BmsTableBrowser } from "./BmsTableBrowser";
import type { BmsDayPoint, BmsScoreRow, BmsSessionRow, BmsTableBlock, BmsVariantCount } from "./types";

function when(value: number | string | null | undefined): string {
  if (value == null) return "";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function playedIso(score: BmsScoreRow): string | null {
  const value = score.playedAt ?? score.achievedAt;
  if (value == null) return null;
  if (typeof value === "number") return new Date(value).toISOString();
  return value;
}

function exLabel(score: BmsScoreRow): string {
  if (score.exScore == null) return "—";
  if (score.maxExScore == null) return String(score.exScore);
  return `${score.exScore} / ${score.maxExScore}`;
}

const GAUGE_LABELS: Record<string, string> = {
  assist_easy: "Assist Easy",
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  ex_hard: "EX Hard",
  hazard: "Hazard",
  class: "Class",
  ex_class: "EX Class",
  ex_hard_class: "EX Hard Class",
};

const JUDGEMENTS = [
  { key: "pgreat", label: "PGREAT", color: "text-accent" },
  { key: "great", label: "GREAT", color: "text-warning" },
  { key: "good", label: "GOOD", color: "text-ink" },
  { key: "bad", label: "BAD", color: "text-subtle" },
  { key: "poor", label: "POOR", color: "text-muted" },
  { key: "miss", label: "MISS", color: "text-danger" },
] as const;

function gaugeLabel(gaugeId: string | null): string | null {
  if (!gaugeId) return null;
  return GAUGE_LABELS[gaugeId] ?? gaugeId;
}

function ScoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-0.5 truncate tabular-nums text-subtle">{value}</div>
    </div>
  );
}

function JudgementStrip({ score }: { score: BmsScoreRow }) {
  const entries = JUDGEMENTS.filter((item) => score[item.key] != null);
  if (entries.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs tabular-nums">
      {entries.map((item) => (
        <span key={item.key} className={item.color}>
          <span className="font-semibold">{score[item.key]}</span>
          <span className="ml-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
            {item.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function BmsScoreCard({ score, priority }: { score: BmsScoreRow; priority: boolean }) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const gauge = gaugeLabel(score.gaugeId);
  const played = formatRelativeTime(playedIso(score), dict?.common);

  return (
    <li className="rx-card flex flex-col">
      <div className="relative">
        <BeatmapCover
          src={score.beatmapId ? `/api/bms/covers/${score.beatmapId}` : null}
          backgroundFileHash={score.backgroundFileHash}
          setOnlineId={score.setOnlineId}
          size="card"
          className="aspect-[2.2/1] w-full"
          alt=""
          priority={priority}
        />
        {gauge ? (
          <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-canvas/85 px-2 py-1 text-[11px] font-semibold leading-none text-ink shadow-sm ring-1 ring-border backdrop-blur-sm">
            {gauge}
          </span>
        ) : null}
      </div>
      <div className="p-4">
        <div className="truncate text-sm text-muted">
          {score.artist ?? dict?.practice.unknownArtist ?? "Unknown artist"}
        </div>
        {score.chartMd5 || score.md5 ? (
          <Link
            to="/bms/charts/$chartId"
            params={{ chartId: score.chartMd5 ?? score.md5 ?? "" }}
            search={{ variant: score.variantId }}
            className="block truncate font-bold text-ink"
          >
            {score.title ?? score.id}
          </Link>
        ) : (
          <div className="truncate font-bold text-ink">{score.title ?? score.id}</div>
        )}
        {score.difficulty ? (
          <div className="mt-1 truncate text-xs text-muted">[{score.difficulty}]</div>
        ) : null}
        {played !== "—" ? <div className="mt-1 truncate text-xs text-muted">{played}</div> : null}
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <ScoreStat label={copy?.grade ?? "Grade"} value={score.djGrade ?? "—"} />
          <ScoreStat label="EX" value={exLabel(score)} />
          <ScoreStat
            label={dict?.practice.detail.statBestAcc ?? "Best acc"}
            value={formatAccuracy(score.accuracy)}
          />
          <ScoreStat label={copy?.lamp ?? "Combo"} value={score.comboLampId ?? "—"} />
          <ScoreStat label={copy?.gauge ?? "Gauge"} value={gauge ?? "—"} />
        </div>
        <JudgementStrip score={score} />
      </div>
    </li>
  );
}

export function BmsProfileView({
  title,
  subtitle,
  username,
  countryCode,
  plays,
  variantId,
  variants,
  scores,
  sessions,
  tables,
  activity,
  achievement,
  onVariant,
  onAchievement,
  showScores,
  showTables,
  local,
  error,
  tablesPending = false,
  profilePending = false,
  scoresPending = false,
  sessionsPending = false,
  scoreCursor = null,
  scoreNextCursor = null,
  onScoreCursor,
}: {
  title: string;
  subtitle?: string;
  username?: string | null;
  countryCode?: string | null;
  plays: number;
  variantId: string | null;
  variants: BmsVariantCount[];
  scores: BmsScoreRow[];
  sessions: BmsSessionRow[];
  tables: BmsTableBlock[];
  activity?: BmsDayPoint[];
  achievement: string;
  onVariant: (variant: string) => void;
  onAchievement: (achievement: string) => void;
  showScores: boolean;
  showTables: boolean;
  local: boolean;
  error?: string | null;
  tablesPending?: boolean;
  profilePending?: boolean;
  scoresPending?: boolean;
  sessionsPending?: boolean;
  scoreCursor?: string | null;
  scoreNextCursor?: string | null;
  onScoreCursor?: (cursor: string | null) => void;
}) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const both = showScores && showTables;
  const [section, setSection] = useState<"scores" | "tables">("tables");
  const scoresOpen = showScores && (!both || section === "scores");
  const tablesOpen = showTables && (!both || section === "tables");
  const variantPlays = variants.find((variant) => variant.variantId === variantId)?.plays;
  const shownPlays = variantPlays ?? plays;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <BmsCommunityNav />
      <header>
        {username ? <p className="rx-label">{title}</p> : null}
        <div className="flex items-start justify-between gap-4">
          <PageTitle>{username ?? title}</PageTitle>
          <div className="shrink-0 text-right">
            {profilePending ? (
              <SkeletonBlock className="ml-auto h-9 w-16" />
            ) : (
              <div className="font-display text-3xl font-bold tabular-nums leading-none text-ink">
                {shownPlays}
              </div>
            )}
            <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-faint">
              {copy?.plays ?? "Plays"}
            </div>
          </div>
        </div>
        {subtitle ? <p className="rx-subtitle max-w-xl">{subtitle}</p> : null}
        {countryCode ? <p className="mt-1 text-sm text-muted">{countryCode}</p> : null}
        {local && username ? (
          <Link
            to="/bms/players/$username"
            params={{ username }}
            className="mt-2 inline-block text-sm font-medium text-accent"
          >
            {copy?.publicTitle ?? "BMS profile"}
          </Link>
        ) : null}
      </header>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {variants.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={copy?.variant ?? "Variant"}>
          {variants.map((variant) => {
            const selected = variant.variantId === variantId;
            return (
              <button
                key={variant.variantId}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`rx-chip transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] ${
                  selected ? "bg-accent text-white" : "bg-elevated text-muted hover:text-ink"
                }`}
                onClick={() => onVariant(variant.variantId)}
              >
                {variant.variantId}
                <span className="tabular-nums opacity-80">{variant.plays}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!local && username ? (
        <nav className="flex gap-5 border-b border-line text-sm font-semibold">
          <Link
            to="/bms/players/$username"
            params={{ username }}
            activeOptions={{ exact: true }}
            activeProps={{ className: "-mb-px border-b-2 border-accent pb-2 text-ink" }}
            inactiveProps={{ className: "-mb-px border-b-2 border-transparent pb-2 text-muted hover:text-ink" }}
          >
            {copy?.overview ?? "Overview"}
          </Link>
          <Link
            to="/bms/players/$username/scores"
            params={{ username }}
            activeOptions={{ exact: true }}
            activeProps={{ className: "-mb-px border-b-2 border-accent pb-2 text-ink" }}
            inactiveProps={{ className: "-mb-px border-b-2 border-transparent pb-2 text-muted hover:text-ink" }}
          >
            {copy?.scores ?? "Scores"}
          </Link>
          <Link
            to="/bms/players/$username/tables"
            params={{ username }}
            activeOptions={{ exact: true }}
            activeProps={{ className: "-mb-px border-b-2 border-accent pb-2 text-ink" }}
            inactiveProps={{ className: "-mb-px border-b-2 border-transparent pb-2 text-muted hover:text-ink" }}
          >
            {copy?.tables ?? "Tables"}
          </Link>
          <Link
            to="/bms/compare"
            search={{ playerA: username }}
            className="-mb-px border-b-2 border-transparent pb-2 text-muted hover:text-ink"
          >
            {copy?.compare ?? "Compare"}
          </Link>
        </nav>
      ) : null}

      {both ? (
        <div className="flex gap-1.5" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={section === "scores"}
            className={section === "scores" ? "rx-btn-primary" : "rx-btn"}
            onClick={() => setSection("scores")}
          >
            {copy?.scores ?? "Scores"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "tables"}
            className={section === "tables" ? "rx-btn-primary" : "rx-btn"}
            onClick={() => setSection("tables")}
          >
            {copy?.tables ?? "Tables"}
          </button>
        </div>
      ) : null}

      {activity && activity.length > 0 ? (
        <section>
          <h2 className="font-display text-lg font-semibold">{copy?.activity ?? "Activity"}</h2>
          <div className="mt-3 flex max-w-xl flex-wrap gap-1" aria-label={copy?.activity ?? "Activity"}>
            {activity.slice(-120).map((day) => (
              <span
                key={day.day}
                title={`${day.day}: ${day.plays}`}
                className="size-3 rounded-[2px] bg-accent"
                style={{ opacity: day.plays === 0 ? 0.15 : 0.35 + Math.min(0.65, day.plays / 8) }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {scoresOpen ? (
        <section>
          <h2 className="font-display text-lg font-semibold">
            {scoreCursor ? (copy?.scores ?? "Scores") : (copy?.recent ?? "Recent scores")}
          </h2>
          {scoresPending ? (
            <div className="mt-3">
              <CardGridSkeleton count={6} />
            </div>
          ) : scores.length === 0 ? (
            error ? null : (
              <p className="mt-3 text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
            )
          ) : (
            <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {scores.map((score, index) => (
                <BmsScoreCard key={score.id} score={score} priority={index < 6} />
              ))}
            </ul>
          )}
          {onScoreCursor && (scoreCursor || scoreNextCursor) ? (
            <div className="mt-3 flex gap-2">
              {scoreCursor ? (
                <button type="button" className="rx-btn" onClick={() => onScoreCursor(null)}>
                  {copy?.newer ?? "Newer"}
                </button>
              ) : null}
              {scoreNextCursor ? (
                <button type="button" className="rx-btn" onClick={() => onScoreCursor(scoreNextCursor)}>
                  {copy?.more ?? "More"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {scoresOpen ? (
        <section>
          <h2 className="font-display text-lg font-semibold">{copy?.sessions ?? "Sessions"}</h2>
          {sessionsPending ? (
            <div className="mt-3">
              <ListSkeleton count={4} showThumbnail={false} />
            </div>
          ) : sessions.length === 0 ? (
            error ? null : (
              <p className="mt-3 text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
            )
          ) : (
            <ul className="mt-3 overflow-hidden rounded-lg bg-surface">
              {sessions.map((session) => (
                <li
                  key={`${session.startedAt}-${session.scoreCount}`}
                  className="grid gap-1 border-b border-line px-3 py-2.5 text-sm last:border-b-0 sm:grid-cols-[11rem_3rem_minmax(0,1fr)] sm:items-baseline sm:gap-3"
                >
                  <span className="tabular-nums text-ink">{when(session.startedAt)}</span>
                  <span className="tabular-nums text-muted">{session.scoreCount}</span>
                  <span className="truncate text-muted">{session.titles.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tablesOpen && !(tables.length === 0 && tablesPending) ? (
        <section>
          {both ? null : (
            <h2 className="mb-4 font-display text-lg font-semibold">{copy?.tables ?? "Tables"}</h2>
          )}
          <BmsTableBrowser tables={tables} achievement={achievement} onAchievement={onAchievement} />
        </section>
      ) : null}
    </div>
  );
}
