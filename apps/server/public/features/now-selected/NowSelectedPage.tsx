import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BeatmapPreviewEmbed } from "../../components/BeatmapPreviewEmbed";
import {
  DensityOverTimeChart,
  HotspotsList,
  PatternWeightsPanel,
} from "../../components/mania-analysis";
import { ModBadges } from "../../components/ModBadges";
import {
  fetchBeatmap,
  fetchTosuLive,
  fetchTosuLiveAnalysis,
  startTosu,
  type TosuLive,
} from "../../lib/api";
import { useChartStyles } from "../../lib/chartStyles";
import { formatAccuracy, formatPp } from "../../lib/format";
import { useAppDict, t } from "../../lib/i18n";
import {
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "../../lib/osuUrls";
import {
  isFourKKeyCount,
  primaryDanSource,
  primaryRatingDisplayTitle,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { NowSelectedSettingsModal } from "./NowSelectedSettingsModal";
import {
  loadNowSelectedLayout,
  saveNowSelectedLayout,
  type NowSelectedLayout,
  type NowSelectedWidgetId,
} from "./nowSelectedLayout";

function isManiaBeatmap(
  beatmap: TosuLive["beatmap"] | null | undefined,
): boolean {
  if (!beatmap) return false;
  const mode = (beatmap.mode ?? "").toLowerCase();
  return (
    beatmap.modeNumber === 3 ||
    mode.includes("mania") ||
    mode === "osu!mania"
  );
}

function liveBackgroundSources(data: TosuLive | undefined): string[] {
  if (!data?.beatmap) return [];
  const urls: string[] = [];
  const checksum = data.beatmap.checksum;
  if (data.connected && data.host) {
    const bust = checksum ? `?v=${encodeURIComponent(checksum)}` : "";
    urls.push(`http://${data.host}/files/beatmap/background${bust}`);
  }
  const local = localBeatmapCoverUrl(data.backgroundFileHash);
  if (local) urls.push(local);
  const cdn = osuBeatmapCoverUrl(data.beatmap.setOnlineId, "cover");
  if (cdn) urls.push(cdn);
  return urls;
}

function statusLabel(
  dict: ReturnType<typeof useAppDict>["dict"],
  data: TosuLive | undefined,
): { text: string; className: string } {
  if (!data || !data.enabled) {
    return {
      text: dict?.session.tosu.disabled ?? "Disabled",
      className: "bg-white/5 text-faint",
    };
  }
  switch (data.status) {
    case "connected":
      return {
        text: dict?.session.tosu.connected ?? "Connected",
        className: "bg-accent-glow text-accent",
      };
    case "connecting":
      return {
        text: dict?.session.tosu.connecting ?? "Connecting…",
        className: "bg-amber-400/15 text-amber-200",
      };
    case "disconnected":
      return {
        text: dict?.session.tosu.tosuDown ?? "Tosu down",
        className: "bg-rose-400/15 text-rose-300",
      };
    default:
      return {
        text: dict?.session.tosu.disabled ?? "Disabled",
        className: "bg-white/5 text-faint",
      };
  }
}

export function NowSelectedPage({
  focus,
}: {
  focus: boolean;
}) {
  const { dict } = useAppDict();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const charts = useChartStyles();
  const ratingMode = useRatingDisplayMode();
  const [layout, setLayout] = useState<NowSelectedLayout>(() =>
    loadNowSelectedLayout(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [failedBg, setFailedBg] = useState<string | null>(null);

  useEffect(() => {
    saveNowSelectedLayout(layout);
  }, [layout]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tosu", "live"],
    queryFn: fetchTosuLive,
    refetchInterval: (query) => {
      const snap = query.state.data;
      if (!snap?.enabled) return false;
      if (snap.status === "connected" && snap.play?.active) return 1_000;
      if (snap.status === "connecting" || snap.status === "disconnected") {
        return 3_000;
      }
      return 5_000;
    },
  });

  const checksum = data?.beatmap?.checksum ?? null;
  const analysisQuery = useQuery({
    queryKey: ["tosu", "live", "analysis", checksum],
    queryFn: fetchTosuLiveAnalysis,
    enabled:
      Boolean(checksum) &&
      data?.status === "connected" &&
      !data.analysis.analyzing,
    staleTime: 60_000,
  });

  const matchedBeatmapId = data?.matchedBeatmapId ?? null;
  const beatmapQuery = useQuery({
    queryKey: ["beatmap", matchedBeatmapId],
    queryFn: () => fetchBeatmap(matchedBeatmapId!),
    enabled: Boolean(matchedBeatmapId) && layout.visible.personalStats,
  });

  const startMut = useMutation({
    mutationFn: startTosu,
    onSuccess: (snap) => {
      queryClient.setQueryData(["tosu", "live"], snap);
    },
  });

  const beatmap = data?.beatmap;
  const play = data?.play;
  const sunny = data?.analysis.sunny;
  const hasMap = Boolean(beatmap?.title || beatmap?.checksum);
  const showMania = isManiaBeatmap(beatmap);
  const chip = statusLabel(dict, data);
  const patternDetail = analysisQuery.data?.detail ?? null;

  const keyCount = sunny?.columnCount ?? beatmap?.keys ?? null;
  const isFourK = isFourKKeyCount(keyCount);
  const titleMode = ratingMode === "osu" ? "dan" : ratingMode;
  const ratingLabels = {
    danielDan: dict?.practice.detail.danielDan ?? "Daniel dan",
    sunnyDan: dict?.practice.detail.sunnyDan ?? "Sunny dan",
    danielStar:
      dict?.settings.ratingDisplay.dan?.labelDanielStar ??
      "Daniel star rating",
    sunnyStar:
      dict?.settings.ratingDisplay.sunny?.label ?? "Sunny star rating",
  };
  const primarySource =
    primaryDanSource({
      mode: titleMode,
      keyCount,
      danielEstDiff: isFourK ? sunny?.estDiff : null,
      sunnyEstDiff: !isFourK ? sunny?.estDiff : null,
      danielStar: isFourK ? sunny?.sunnyStar : null,
      sunnyStar: !isFourK ? sunny?.sunnyStar : null,
    }) ?? (isFourK ? "daniel" : keyCount != null ? "sunny" : null);
  const analysisLabel =
    primaryRatingDisplayTitle(titleMode, primarySource, ratingLabels) ??
    dict?.practice.detail.sunnyDan ??
    "Sunny dan";

  const bgSources = useMemo(() => liveBackgroundSources(data), [data]);
  const bgKey = `${beatmap?.checksum ?? ""}|${data?.backgroundFileHash ?? ""}|${data?.host ?? ""}`;

  useEffect(() => {
    setFailedBg(null);
  }, [bgKey]);

  const bgSrc = (() => {
    if (bgSources.length === 0) return null;
    if (!failedBg) return bgSources[0]!;
    const idx = bgSources.indexOf(failedBg);
    if (idx < 0) return bgSources[0]!;
    return bgSources[idx + 1] ?? null;
  })();

  const playingAllowed = !(layout.pauseWhilePlaying && play?.active);

  function setFocus(next: boolean) {
    void navigate({
      to: "/now-selected",
      search: { focus: next || undefined },
    });
  }

  const ns = dict?.nowSelected;
  const personal =
    beatmapQuery.data && "stats" in beatmapQuery.data
      ? beatmapQuery.data
      : null;

  const widgets: Record<NowSelectedWidgetId, ReactNode> = {
    identity: hasMap && beatmap ? (
      <IdentityWidget
        beatmap={beatmap}
        dict={dict}
        bgSrc={bgSrc}
        onBgError={() => bgSrc && setFailedBg(bgSrc)}
        matchedBeatmapId={matchedBeatmapId}
      />
    ) : null,
    preview:
      hasMap && matchedBeatmapId ? (
        <BeatmapPreviewEmbed
          key={matchedBeatmapId}
          beatmapId={matchedBeatmapId}
          autoPlay={layout.autoPlayPreview}
          muted={layout.mutePreview}
          playingAllowed={playingAllowed}
        />
      ) : hasMap ? (
        <p className="text-sm text-faint">
          {dict?.session.tosu.notInLibrary ??
            "Map not in Roxysu library yet — showing ephemeral analysis."}
        </p>
      ) : null,
    patternWeights:
      showMania && patternDetail && !patternDetail.error ? (
        <PatternWeightsPanel
          composition={patternDetail.composition}
          keyCount={patternDetail.columnCount ?? keyCount}
          accentColor={charts.chartAlt}
        />
      ) : null,
    densityOverTime:
      showMania && patternDetail && patternDetail.samples.length > 0 ? (
        <DensityOverTimeChart
          samples={patternDetail.samples}
          height={260}
          gradientId="now-selected-density-fill"
        />
      ) : null,
    livePlay: hasMap ? (
      play?.active ? (
        <p className="text-sm text-muted">
          {t(dict?.session.tosu.liveCombo, {
            combo: play.combo ?? 0,
          }) || `Live · combo ${play.combo ?? 0}`}
          {play.maxCombo != null ? ` / ${play.maxCombo}` : ""}
          {" · "}
          {play.accuracy != null ? formatAccuracy(play.accuracy) : "—"}
          {" · "}
          {t(dict?.session.tosu.misses, {
            count: play.misses ?? 0,
          }) || `${play.misses ?? 0} miss`}
          {play.pp != null ? ` · ${Math.round(play.pp)}pp` : ""}
        </p>
      ) : (
        <p className="text-sm text-faint">
          {beatmap?.state
            ? t(dict?.session.tosu.state, { state: beatmap.state }) ||
              `State: ${beatmap.state}`
            : dict?.session.tosu.songSelect ?? "Song select"}
        </p>
      )
    ) : null,
    rating: showMania ? (
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-faint">
          {analysisLabel}
          {beatmap?.rate != null && Math.abs(beatmap.rate - 1) > 0.001
            ? ` · ×${beatmap.rate.toFixed(2).replace(/\.?0+$/, "")}`
            : ""}
        </div>
        <p className="mt-1 text-sm text-ink">
          {sunny?.estDiff ?? "—"}
          {sunny?.sunnyStar != null ? ` · ${sunny.sunnyStar.toFixed(2)}★` : ""}
        </p>
        {sunny?.error ? (
          <p className="mt-0.5 text-xs text-rose-300">{sunny.error}</p>
        ) : null}
      </div>
    ) : null,
    hotspots:
      showMania && patternDetail ? (
        <HotspotsList hotspots={patternDetail.hotspots} />
      ) : null,
    personalStats:
      matchedBeatmapId && personal && "stats" in personal ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat
            label={ns?.plays ?? "Plays"}
            value={String(personal.stats?.playCount ?? 0)}
          />
          <MiniStat
            label={ns?.bestAcc ?? "Best acc"}
            value={formatAccuracy(personal.stats?.bestAccuracy)}
          />
          <MiniStat
            label={ns?.bestPp ?? "Best PP"}
            value={formatPp(personal.stats?.bestPp ?? null)}
          />
        </div>
      ) : null,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {ns?.title ?? dict?.session.tosu.nowSelected ?? "Now selected"}
          </h1>
          <span className={`rx-chip ${chip.className}`}>{chip.text}</span>
          {data?.analysis.analyzing ? (
            <span className="text-xs text-muted">
              {dict?.session.tosu.analyzing ?? "Analyzing…"}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {focus ? (
            <button
              type="button"
              className="rx-btn text-sm"
              onClick={() => setFocus(false)}
            >
              {ns?.exitFocus ?? "Exit focus"}
            </button>
          ) : (
            <button
              type="button"
              className="rx-btn text-sm"
              onClick={() => setFocus(true)}
            >
              {ns?.enterFocus ?? "Focus"}
            </button>
          )}
          <button
            type="button"
            className="rx-btn text-sm"
            onClick={() => setSettingsOpen(true)}
          >
            {ns?.layout ?? "Layout"}
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <p className="text-sm text-muted">
          {dict?.session.tosu.connectingTosu ?? "Connecting to tosu…"}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-rose-300">{error.message}</p>
      ) : null}

      {data && !data.enabled ? (
        <p className="text-sm text-muted">
          {(() => {
            const parts = (
              dict?.session.tosu.adapterOff ??
              "Tosu live adapter is off. Enable it in ⟦SETTINGS⟧."
            ).split("⟦SETTINGS⟧");
            return (
              <>
                {parts[0]}
                <Link to="/settings" className="text-accent hover:underline">
                  {dict?.nav.settings ?? "Settings"}
                </Link>
                {parts[1]}
              </>
            );
          })()}
        </p>
      ) : null}

      {data?.warnings?.length ? (
        <ul className="space-y-1 text-sm text-amber-200/90">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {data &&
      data.enabled &&
      data.status !== "connected" &&
      !startMut.isSuccess ? (
        <button
          type="button"
          className="rx-btn-primary text-sm"
          disabled={startMut.isPending}
          onClick={() => startMut.mutate()}
        >
          {startMut.isPending
            ? dict?.session.tosu.starting ?? "Starting…"
            : dict?.session.tosu.startTosu ?? "Start tosu"}
        </button>
      ) : null}

      {data?.enabled && data.status === "connected" && !hasMap ? (
        <p className="text-sm text-muted">
          {dict?.session.tosu.waitingForMap ??
            "Waiting for a selected map from osu!…"}
        </p>
      ) : null}

      {hasMap ? (
        <div className="space-y-4">
          {layout.order.map((id) => {
            if (!layout.visible[id]) return null;
            const node = widgets[id];
            if (!node) return null;
            return (
              <section key={id} className="rx-panel p-4 sm:p-5">
                {node}
              </section>
            );
          })}
        </div>
      ) : null}

      {settingsOpen ? (
        <NowSelectedSettingsModal
          layout={layout}
          focus={focus}
          onChange={setLayout}
          onFocusChange={setFocus}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function IdentityWidget({
  beatmap,
  dict,
  bgSrc,
  onBgError,
  matchedBeatmapId,
}: {
  beatmap: NonNullable<TosuLive["beatmap"]>;
  dict: ReturnType<typeof useAppDict>["dict"];
  bgSrc: string | null;
  onBgError: () => void;
  matchedBeatmapId: string | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl">
      {bgSrc ? (
        <>
          <img
            key={bgSrc}
            src={bgSrc}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            onError={onBgError}
            className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-canvas/80 backdrop-blur-[2px]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-canvas/90 via-canvas/70 to-canvas/55"
          />
        </>
      ) : null}
      <div className="relative z-10 space-y-2 p-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-lg font-semibold text-ink drop-shadow-sm">
            {beatmap.title ?? dict?.session.untitled}
          </span>
          {beatmap.keys != null ? (
            <span className="rx-chip bg-black/35 text-ink">
              {beatmap.keys}K
            </span>
          ) : null}
          {beatmap.mode ? (
            <span className="text-xs text-faint">{beatmap.mode}</span>
          ) : null}
        </div>
        <p className="truncate text-sm text-muted">
          {beatmap.artist ?? dict?.session.unknownArtist}
          {beatmap.version ? ` · ${beatmap.version}` : ""}
          {beatmap.mapper
            ? ` · ${
                t(dict?.session.tosu.mappedBy, { mapper: beatmap.mapper }) ||
                `mapped by ${beatmap.mapper}`
              }`
            : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ModBadges mods={beatmap.mods} />
          {beatmap.starRating != null ? (
            <span className="text-xs text-faint">
              {beatmap.starRating.toFixed(2)}★
            </span>
          ) : null}
          {matchedBeatmapId ? (
            <Link
              to="/practice/$beatmapId"
              params={{ beatmapId: matchedBeatmapId }}
              className="rx-btn text-sm"
            >
              {dict?.session.tosu.practiceProfile ?? "Practice profile"}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}
