import { useQuery } from "@tanstack/react-query";
import {
  BeatmapCover,
} from "../../components/BeatmapCover";
import { ModBadges } from "../../components/ModBadges";
import { BeatmapPreviewEmbed } from "../../components/BeatmapPreviewEmbed";
import { DensityOverTimeChart } from "../../components/mania-analysis";
import { fetchBeatmapStats, fetchTosuLiveAnalysis, type TosuLive } from "../../lib/api";
import { useAppDict } from "../../lib/i18n";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  clampPreviewHeightRem,
  clampScoreListLimit,
} from "./profileModel";

export type OverlayScoreView = {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  accuracy: number | null;
  pp: number | null;
  mods: string | null;
  playedAt: string | null;
  isPb: boolean;
  setOnlineId: number | null;
  backgroundFileHash: string | null;
};

export type OverlaySessionView = {
  id: number;
  name: string;
  scoreCount: number;
} | null;

export type OverlayElementContext = {
  bg: "solid" | "clear";
  mode: "live" | "recent" | "empty";
  scores: OverlayScoreView[];
  freshIds: Set<string>;
  session: OverlaySessionView;
  snapshot: TosuLive | null;
};

function Panel({
  ctx,
  children,
}: {
  ctx: OverlayElementContext;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        ctx.bg === "solid"
          ? "rounded-xl border border-white/10 bg-[#0d0d0d]/92 px-3 py-3 shadow-2xl shadow-black/60 backdrop-blur-md"
          : ""
      }
    >
      {children}
    </div>
  );
}

export function ScoreListElement({ ctx }: { ctx: OverlayElementContext }) {
  const { dict } = useAppDict();
  const mode = ctx.mode;
  if (mode === "empty") return null;
  return (
    <Panel ctx={ctx}>
      <header className="mb-2.5 flex items-center gap-2 px-0.5">
        {mode === "live" ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-accent overlay-text">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {dict?.overlay.liveSession ?? "Live session"}
            {ctx.session ? (
              <span className="font-semibold normal-case tracking-normal text-white/75">
                · {ctx.session.scoreCount} plays
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/80 overlay-text">
            {dict?.overlay.recentScores ?? "Recent scores"}
          </span>
        )}
      </header>

      <ul className="flex flex-col gap-1">
        {ctx.scores.map((score) => {
          const isFresh = ctx.freshIds.has(score.id);
          return (
            <li
              key={score.id}
              className={`overlay-row flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-700 ${
                ctx.bg === "solid"
                  ? isFresh
                    ? "bg-accent/15"
                    : "bg-white/[0.06]"
                  : isFresh
                    ? "bg-black/70"
                    : "bg-black/55"
              }`}
            >
              <BeatmapCover
                backgroundFileHash={score.backgroundFileHash}
                setOnlineId={score.setOnlineId}
                size="list"
                className="h-9 w-9 shrink-0 rounded shadow-md shadow-black/50"
                alt=""
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-white overlay-text">
                    {score.title ?? dict?.session.untitled ?? "Untitled"}
                  </span>
                  {score.isPb ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-300 overlay-text">
                      {dict?.session.pb ?? "PB"}
                    </span>
                  ) : null}
                  {isFresh ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-accent overlay-text">
                      {dict?.session.new ?? "New"}
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-1 truncate text-xs text-white/70 overlay-text">
                  <span className="truncate">
                    {score.difficultyName ?? score.artist ?? "—"}
                  </span>
                  <ModBadges mods={score.mods} variant="overlay" />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums text-white overlay-text">
                  {formatAccuracy(score.accuracy)}
                </div>
                <div className="text-[11px] tabular-nums text-white/65 overlay-text">
                  {formatPp(score.pp)}
                  {mode === "recent"
                    ? ` · ${formatRelativeTime(score.playedAt, dict?.common)}`
                    : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function useLiveBeatmap(snapshot: TosuLive | null) {
  return snapshot?.beatmap ?? null;
}

export function IdentityElement({ ctx }: { ctx: OverlayElementContext }) {
  const beatmap = useLiveBeatmap(ctx.snapshot);
  const { dict } = useAppDict();
  if (!beatmap) return null;
  return (
    <Panel ctx={ctx}>
      <div className="flex items-center gap-3">
        <BeatmapCover
          backgroundFileHash={ctx.snapshot?.backgroundFileHash ?? null}
          setOnlineId={beatmap.setOnlineId}
          size="list"
          className="h-12 w-12 shrink-0 rounded shadow-md shadow-black/50"
          alt=""
        />
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-white overlay-text">
            {beatmap.title ?? dict?.session.untitled ?? "Untitled"}
          </div>
          <div className="truncate text-xs text-white/75 overlay-text">
            {[beatmap.artist, beatmap.version].filter(Boolean).join(" · ") || "—"}
          </div>
          {beatmap.mapper ? (
            <div className="truncate text-[11px] text-white/55 overlay-text">
              mapped by {beatmap.mapper}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

export function DifficultyElement({ ctx }: { ctx: OverlayElementContext }) {
  const beatmap = useLiveBeatmap(ctx.snapshot);
  if (!beatmap) return null;
  return (
    <Panel ctx={ctx}>
      <div className="flex items-center gap-2">
        <ModBadges mods={beatmap.mods} variant="overlay" />
        <span className="text-sm font-semibold tabular-nums text-accent overlay-text">
          {beatmap.starRating != null ? `${beatmap.starRating.toFixed(2)}★` : "—"}
        </span>
        {beatmap.keys != null ? (
          <span className="text-xs text-white/70 overlay-text">{beatmap.keys}K</span>
        ) : null}
        {beatmap.mode ? (
          <span className="text-xs uppercase tracking-wide text-white/60 overlay-text">
            {beatmap.mode}
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

export function LivePlayElement({ ctx }: { ctx: OverlayElementContext }) {
  const play = ctx.snapshot?.play ?? null;
  if (!play) return null;
  const cells = [
    { label: "Acc", value: formatAccuracy(play.accuracy) },
    { label: "Combo", value: play.combo != null ? String(play.combo) : "—" },
    { label: "Score", value: play.score != null ? play.score.toLocaleString() : "—" },
    { label: "PP", value: formatPp(play.pp) },
    { label: "Miss", value: play.misses != null ? String(play.misses) : "—" },
  ];
  return (
    <Panel ctx={ctx}>
      <div className="grid grid-cols-5 gap-x-3 gap-y-1">
        {cells.map((cell) => (
          <div key={cell.label}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-white/55 overlay-text">
              {cell.label}
            </div>
            <div className="text-sm font-semibold tabular-nums text-white overlay-text">
              {cell.value}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function PreviewElement({
  ctx,
  element,
}: {
  ctx: OverlayElementContext;
  element: { options?: Record<string, unknown> };
}) {
  const beatmapId = ctx.snapshot?.matchedBeatmapId ?? null;
  const heightRem = clampPreviewHeightRem(element.options?.previewHeightRem);
  if (!beatmapId) return null;
  return (
    <BeatmapPreviewEmbed
      beatmapId={beatmapId}
      autoPlay
      muted
      playingAllowed={!ctx.snapshot?.play?.active}
      heightRem={heightRem}
    />
  );
}

export function AnalysisElement({ ctx }: { ctx: OverlayElementContext }) {
  const analysis = ctx.snapshot?.analysis ?? null;
  if (!analysis || (!analysis.sunny && !analysis.pattern)) return null;
  const sunny = analysis.sunny;
  const pattern = analysis.pattern;
  return (
    <Panel ctx={ctx}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {sunny?.estDiff || sunny?.sunnyStar != null ? (
          <span className="text-sm font-semibold text-white overlay-text">
            {sunny.estDiff ?? ""}
            {sunny.sunnyStar != null ? ` ${sunny.sunnyStar.toFixed(2)}★` : ""}
          </span>
        ) : null}
        {pattern?.dominantPattern ? (
          <span className="text-xs capitalize text-white/70 overlay-text">
            {pattern.dominantPattern}
            {pattern.secondaryPattern ? ` + ${pattern.secondaryPattern}` : ""}
          </span>
        ) : null}
        {sunny?.lnRatio != null ? (
          <span className="text-[11px] text-white/55 overlay-text">
            LN {(sunny.lnRatio * 100).toFixed(0)}%
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

export function SessionStatsElement({ ctx }: { ctx: OverlayElementContext }) {
  if (ctx.mode === "empty") return null;
  const name =
    ctx.mode === "live"
      ? ctx.session?.name ?? "—"
      : ctx.session?.name ?? undefined;
  const plays =
    ctx.mode === "live"
      ? ctx.session?.scoreCount
      : ctx.session?.scoreCount ?? ctx.scores.length;
  return (
    <Panel ctx={ctx}>
      <div className="text-sm font-semibold text-white overlay-text">
        {name ?? "—"}
      </div>
      {plays != null ? (
        <div className="text-xs text-white/65 overlay-text">{plays} plays</div>
      ) : null}
    </Panel>
  );
}

export function PersonalStatsElement({ ctx }: { ctx: OverlayElementContext }) {
  const beatmapId = ctx.snapshot?.matchedBeatmapId ?? null;
  const statsQuery = useQuery({
    queryKey: ["beatmap-stats", beatmapId],
    queryFn: () => fetchBeatmapStats(beatmapId as string),
    enabled: beatmapId != null,
    staleTime: 30_000,
  });
  const personal = statsQuery.data;
  if (!beatmapId || !personal) return null;
  return (
    <Panel ctx={ctx}>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/55 overlay-text">
            Plays
          </div>
          <div className="text-sm font-semibold tabular-nums text-white overlay-text">
            {personal.playCount ?? 0}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/55 overlay-text">
            Best acc
          </div>
          <div className="text-sm font-semibold tabular-nums text-white overlay-text">
            {formatAccuracy(personal.bestAccuracy)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/55 overlay-text">
            Best PP
          </div>
          <div className="text-sm font-semibold tabular-nums text-white overlay-text">
            {formatPp(personal.bestPp ?? null)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function DensityElement({ ctx }: { ctx: OverlayElementContext }) {
  const analysisQuery = useQuery({
    queryKey: ["tosu", "live-analysis-density"],
    queryFn: fetchTosuLiveAnalysis,
    enabled: ctx.snapshot?.matchedBeatmapId != null,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  const samples = analysisQuery.data?.detail?.samples ?? [];
  if (samples.length === 0) return null;
  return (
    <DensityOverTimeChart
      samples={samples}
      height={90}
      gradientId="overlay-density-fill"
    />
  );
}
