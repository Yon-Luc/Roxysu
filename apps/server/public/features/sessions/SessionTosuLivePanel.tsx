import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { BeatmapPreviewButton } from "../../components/BeatmapPreviewButton";
import { ModBadges } from "../../components/ModBadges";
import { startTosu, type TosuLive } from "../../lib/api";
import { useTosuLiveQuery } from "../../lib/useTosuLiveQuery";
import { formatAccuracy } from "../../lib/format";
import { useAppDict, t } from "../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";
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

const PREFS_KEY = "rx-session-tosu-panel";

function loadVisible(): boolean {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function statusLabel(
  dict: Dictionary["app"] | undefined,
  data: TosuLive | undefined,
): {
  text: string;
  className: string;
} {
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
        className: "bg-warning/15 text-warning",
      };
    case "disconnected":
      return {
        text: dict?.session.tosu.tosuDown ?? "Tosu down",
        className: "bg-danger/15 text-danger",
      };
    default:
      return {
        text: dict?.session.tosu.disabled ?? "Disabled",
        className: "bg-white/5 text-faint",
      };
  }
}

function formatPattern(label: string | null | undefined): string | null {
  if (!label) return null;
  return label.replace(/([a-z])([A-Z])/g, "$1 $2");
}

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

export function SessionTosuLivePanel() {
  const { dict } = useAppDict();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(() => loadVisible());
  const [failedBg, setFailedBg] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, visible ? "1" : "0");
  }, [visible]);

  const { data, isLoading, error } = useTosuLiveQuery({
    enabled: visible,
  });

  const startMut = useMutation({
    mutationFn: startTosu,
    onSuccess: (snap) => {
      queryClient.setQueryData(["tosu", "live"], snap);
    },
  });

  const ratingMode = useRatingDisplayMode();
  const chip = statusLabel(dict, data);
  const beatmap = data?.beatmap;
  const play = data?.play;
  const sunny = data?.analysis.sunny;
  const pattern = data?.analysis.pattern;
  const hasMap = Boolean(beatmap?.title || beatmap?.checksum);
  const showManiaAnalysis = isManiaBeatmap(beatmap);

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

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
            {dict?.session.tosu.nowSelected ?? "Now selected"}
          </h2>
          <span className={`rx-chip ${chip.className}`}>{chip.text}</span>
          {data?.analysis.analyzing ? (
            <span className="text-xs text-muted">
              {dict?.session.tosu.analyzing ?? "Analyzing…"}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="rx-btn text-sm"
          onClick={() => setVisible((v) => !v)}
        >
          {visible
            ? dict?.session.tosu.hide ?? "Hide"
            : dict?.session.tosu.show ?? "Show"}
        </button>
      </div>

      {visible ? (
        <div className="rx-panel relative overflow-hidden">
          {bgSrc ? (
            <>
              <img
                key={bgSrc}
                src={bgSrc}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                onError={() => setFailedBg(bgSrc)}
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

          <div className="relative z-10 space-y-4 p-5">
            {isLoading && !data ? (
              <p className="text-sm text-muted">
                {dict?.session.tosu.connectingTosu ?? "Connecting to tosu…"}
              </p>
            ) : null}

            {error ? (
              <p className="text-sm text-danger">{error.message}</p>
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
                      <Link
                        to="/settings"
                        className="text-accent hover:underline"
                      >
                        Settings
                      </Link>
                      {parts[1]}
                    </>
                  );
                })()}
              </p>
            ) : null}

            {data?.warnings?.length ? (
              <ul className="space-y-1 text-sm text-warning/90">
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

            {hasMap ? (
              <div className="space-y-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-semibold text-ink drop-shadow-sm">
                      {beatmap?.title ?? dict?.session.untitled}
                    </span>
                    {beatmap?.keys != null ? (
                      <span className="rx-chip bg-black/35 text-ink">
                        {beatmap.keys}K
                      </span>
                    ) : null}
                    {beatmap?.mode ? (
                      <span className="text-xs text-faint">{beatmap.mode}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {beatmap?.artist ?? dict?.session.unknownArtist}
                    {beatmap?.version ? ` · ${beatmap.version}` : ""}
                    {beatmap?.mapper
                      ? ` · ${
                          t(dict?.session.tosu.mappedBy, {
                            mapper: beatmap.mapper,
                          }) || `mapped by ${beatmap.mapper}`
                        }`
                      : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ModBadges mods={beatmap?.mods} />
                    {beatmap?.starRating != null ? (
                      <span className="text-xs text-faint">
                        {beatmap.starRating.toFixed(2)}★
                      </span>
                    ) : null}
                  </div>
                </div>

                {showManiaAnalysis ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-faint">
                        {analysisLabel}
                        {beatmap?.rate != null &&
                        Math.abs(beatmap.rate - 1) > 0.001
                          ? ` · ×${beatmap.rate.toFixed(2).replace(/\.?0+$/, "")}`
                          : ""}
                      </div>
                      <p className="mt-1 text-sm text-ink">
                        {sunny?.estDiff ?? "—"}
                        {sunny?.sunnyStar != null
                          ? ` · ${sunny.sunnyStar.toFixed(2)}★`
                          : ""}
                      </p>
                      {sunny?.error ? (
                        <p className="mt-0.5 text-xs text-danger">
                          {sunny.error}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-faint">
                        {dict?.session.tosu.patterns ?? "Patterns"}
                      </div>
                      <p className="mt-1 text-sm text-ink">
                        {formatPattern(pattern?.dominantPattern) ?? "—"}
                        {pattern?.secondaryPattern
                          ? ` / ${formatPattern(pattern.secondaryPattern)}`
                          : ""}
                        {pattern?.confidence != null
                          ? ` · ${Math.round(pattern.confidence * 100)}%`
                          : ""}
                      </p>
                      {pattern?.error ? (
                        <p className="mt-0.5 text-xs text-danger">
                          {pattern.error}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {play?.active ? (
                  <p className="text-sm text-muted">
                    {t(dict?.session.tosu.liveCombo, {
                      combo: play.combo ?? 0,
                    }) || `Live · combo ${play.combo ?? 0}`}
                    {play.maxCombo != null ? ` / ${play.maxCombo}` : ""}
                    {" · "}
                    {play.accuracy != null
                      ? formatAccuracy(play.accuracy)
                      : "—"}
                    {" · "}
                    {t(dict?.session.tosu.misses, {
                      count: play.misses ?? 0,
                    }) || `${play.misses ?? 0} miss`}
                    {play.pp != null ? ` · ${Math.round(play.pp)}pp` : ""}
                  </p>
                ) : (
                  <p className="text-sm text-faint">
                    {beatmap?.state
                      ? t(dict?.session.tosu.state, {
                          state: beatmap.state,
                        }) || `State: ${beatmap.state}`
                      : dict?.session.tosu.songSelect ?? "Song select"}
                  </p>
                )}

                {data?.matchedBeatmapId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <BeatmapPreviewButton beatmapId={data.matchedBeatmapId} />
                    <Link
                      to="/practice/$beatmapId"
                      params={{ beatmapId: data.matchedBeatmapId }}
                      className="rx-btn text-sm"
                    >
                      {dict?.session.tosu.practiceProfile ?? "Practice profile"}
                    </Link>
                  </div>
                ) : (
                  <p className="text-xs text-faint">
                    {dict?.session.tosu.notInLibrary ??
                      "Map not in Roxysu library yet — showing ephemeral analysis."}
                  </p>
                )}
              </div>
            ) : data?.enabled && data.status === "connected" ? (
              <p className="text-sm text-muted">
                {dict?.session.tosu.waitingForMap ??
                  "Waiting for a selected map from osu!…"}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
