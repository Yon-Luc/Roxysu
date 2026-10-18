import { Link } from "@tanstack/react-router";
import { BeatmapCover } from "../../components/BeatmapCover";
import { PageTitle } from "../../components/PageTitle";
import { formatAccuracy, formatRelativeTime } from "../../lib/format";
import { t, useAppDict } from "../../lib/i18n";
import type { BmsScoreRow, BmsSessionRow, BmsTableBlock, BmsVariantCount } from "./types";
import { BMS_ACHIEVEMENTS } from "./types";

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

function BmsScoreCard({ score, priority }: { score: BmsScoreRow; priority: boolean }) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const meta = [score.gaugeId, formatRelativeTime(playedIso(score), dict?.common)]
    .filter((part) => part && part !== "—")
    .join(" · ");

  return (
    <li className="rx-card flex flex-col">
      <BeatmapCover
        backgroundFileHash={score.backgroundFileHash}
        setOnlineId={score.setOnlineId}
        size="card"
        className="aspect-[2.2/1] w-full"
        alt=""
        priority={priority}
      />
      <div className="p-4">
        <div className="truncate text-sm text-muted">
          {score.artist ?? dict?.practice.unknownArtist ?? "Unknown artist"}
        </div>
        <div className="truncate font-bold text-ink">{score.title ?? score.id}</div>
        {score.difficulty ? (
          <div className="mt-1 truncate text-xs text-muted">[{score.difficulty}]</div>
        ) : null}
        {meta ? <div className="mt-1 truncate text-xs text-muted">{meta}</div> : null}
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <ScoreStat label={copy?.grade ?? "Grade"} value={score.djGrade ?? "—"} />
          <ScoreStat label="EX" value={exLabel(score)} />
          <ScoreStat
            label={dict?.practice.detail.statBestAcc ?? "Best acc"}
            value={formatAccuracy(score.accuracy)}
          />
          <ScoreStat label={copy?.lamp ?? "Combo"} value={score.comboLampId ?? "—"} />
        </div>
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
  achievement,
  onVariant,
  onAchievement,
  showScores,
  showTables,
  local,
  error,
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
  achievement: string;
  onVariant: (variant: string) => void;
  onAchievement: (achievement: string) => void;
  showScores: boolean;
  showTables: boolean;
  local: boolean;
  error?: string | null;
}) {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <PageTitle>{title}</PageTitle>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          {username ? (
            <p className="mt-2 text-sm text-ink">
              {local ? (
                <Link
                  to="/bms/players/$username"
                  params={{ username }}
                  className="font-semibold text-accent"
                >
                  {username}
                </Link>
              ) : (
                <span className="font-semibold">{username}</span>
              )}
              {countryCode ? <span className="ml-2 text-muted">{countryCode}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl bg-base px-4 py-3">
          <div className="font-display text-2xl font-bold tabular-nums text-ink">{plays}</div>
          <div className="text-xs text-muted">{copy?.plays ?? "Plays"}</div>
        </div>
      </div>

      {error ? <p className="text-sm text-warning">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {variants.map((variant) => (
          <button
            key={variant.variantId}
            type="button"
            className={variant.variantId === variantId ? "rx-btn-primary" : "rx-btn"}
            onClick={() => onVariant(variant.variantId)}
          >
            {variant.variantId} · {variant.plays}
          </button>
        ))}
      </div>

      {!local && username ? (
        <div className="flex gap-3 text-sm">
          <Link
            to="/bms/players/$username"
            params={{ username }}
            activeOptions={{ exact: true }}
            className="text-accent"
          >
            {copy?.overview ?? "Overview"}
          </Link>
          <Link
            to="/bms/players/$username/scores"
            params={{ username }}
            activeOptions={{ exact: true }}
            className="text-accent"
          >
            {copy?.scores ?? "Scores"}
          </Link>
          <Link
            to="/bms/players/$username/tables"
            params={{ username }}
            activeOptions={{ exact: true }}
            className="text-accent"
          >
            {copy?.tables ?? "Tables"}
          </Link>
        </div>
      ) : null}

      {showScores ? (
        <section>
          <h2 className="font-display text-lg font-semibold">{copy?.recent ?? "Recent scores"}</h2>
          {scores.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
          ) : (
            <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {scores.map((score, index) => (
                <BmsScoreCard key={score.id} score={score} priority={index < 6} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {showScores ? (
        <section className="rx-panel p-4">
          <h2 className="font-display text-lg font-semibold">{copy?.sessions ?? "Sessions"}</h2>
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{copy?.noScores ?? "No BMS scores yet."}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {sessions.map((session) => (
                <li key={`${session.startedAt}-${session.scoreCount}`} className="text-sm">
                  <span className="font-medium">{when(session.startedAt)}</span>
                  <span className="text-muted"> · {session.scoreCount}</span>
                  {session.titles.length > 0 ? (
                    <span className="text-muted"> · {session.titles.join(", ")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {showTables ? (
        <section className="rx-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">{copy?.tables ?? "Tables"}</h2>
            <label className="flex items-center gap-2 text-sm text-muted">
              {copy?.achievement ?? "Achievement"}
              <select
                className="rx-select"
                value={achievement}
                onChange={(event) => onAchievement(event.target.value)}
              >
                {BMS_ACHIEVEMENTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {tables.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              {copy?.noTables ??
                "No table is cached yet. Table completion appears after the Hub has a table and this app can reach it."}
            </p>
          ) : (
            tables.map((table) => (
              <div key={table.versionId} className="mt-4">
                <h3 className="font-semibold">
                  {table.symbol ? `${table.symbol} · ` : ""}
                  {table.name}
                </h3>
                {table.unresolvedCount > 0 ? (
                  <p className="text-xs text-muted">
                    {t(copy?.unresolved, { count: table.unresolvedCount })}
                  </p>
                ) : null}
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {table.levels.map((level) => (
                    <li key={level.level} className="rounded-lg bg-base px-3 py-2 text-sm">
                      <div className="flex justify-between">
                        <span>{level.level}</span>
                        <span className="tabular-nums">
                          {t(copy?.cleared, { cleared: level.cleared, total: level.total })}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
