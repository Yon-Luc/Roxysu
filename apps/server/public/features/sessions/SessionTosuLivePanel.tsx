import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ModBadges } from "../../components/ModBadges";
import { fetchTosuLive, startTosu, type TosuLive } from "../../lib/api";
import { formatAccuracy } from "../../lib/format";

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

function statusLabel(data: TosuLive | undefined): {
  text: string;
  className: string;
} {
  if (!data || !data.enabled) {
    return {
      text: "Disabled",
      className: "bg-white/5 text-faint",
    };
  }
  switch (data.status) {
    case "connected":
      return {
        text: "Connected",
        className: "bg-accent-glow text-accent",
      };
    case "connecting":
      return {
        text: "Connecting…",
        className: "bg-amber-400/15 text-amber-200",
      };
    case "disconnected":
      return {
        text: "Tosu down",
        className: "bg-rose-400/15 text-rose-300",
      };
    default:
      return {
        text: "Disabled",
        className: "bg-white/5 text-faint",
      };
  }
}

function formatPattern(label: string | null | undefined): string | null {
  if (!label) return null;
  return label.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function SessionTosuLivePanel() {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(() => loadVisible());

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, visible ? "1" : "0");
  }, [visible]);

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

  const startMut = useMutation({
    mutationFn: startTosu,
    onSuccess: (snap) => {
      queryClient.setQueryData(["tosu", "live"], snap);
    },
  });

  const chip = statusLabel(data);
  const beatmap = data?.beatmap;
  const play = data?.play;
  const sunny = data?.analysis.sunny;
  const pattern = data?.analysis.pattern;
  const hasMap = Boolean(beatmap?.title || beatmap?.checksum);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
            Now selected
          </h2>
          <span className={`rx-chip ${chip.className}`}>{chip.text}</span>
          {data?.analysis.analyzing ? (
            <span className="text-xs text-muted">Analyzing…</span>
          ) : null}
        </div>
        <button
          type="button"
          className="rx-btn text-sm"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {visible ? (
        <div className="rx-panel space-y-4 p-5">
          {isLoading && !data ? (
            <p className="text-sm text-muted">Connecting to tosu…</p>
          ) : null}

          {error ? (
            <p className="text-sm text-rose-300">{error.message}</p>
          ) : null}

          {data && !data.enabled ? (
            <p className="text-sm text-muted">
              Tosu live adapter is off. Enable it in{" "}
              <Link to="/settings" className="text-accent hover:underline">
                Settings
              </Link>
              .
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
              {startMut.isPending ? "Starting…" : "Start tosu"}
            </button>
          ) : null}

          {hasMap ? (
            <div className="space-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-lg font-semibold text-ink">
                    {beatmap?.title ?? "Untitled"}
                  </span>
                  {beatmap?.keys != null ? (
                    <span className="rx-chip bg-white/5 text-muted">
                      {beatmap.keys}K
                    </span>
                  ) : null}
                  {beatmap?.mode ? (
                    <span className="text-xs text-faint">{beatmap.mode}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {beatmap?.artist ?? "Unknown"}
                  {beatmap?.version ? ` · ${beatmap.version}` : ""}
                  {beatmap?.mapper ? ` · mapped by ${beatmap.mapper}` : ""}
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

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-faint">
                    Sunny
                    {beatmap?.rate != null && Math.abs(beatmap.rate - 1) > 0.001
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
                    <p className="mt-0.5 text-xs text-rose-300">{sunny.error}</p>
                  ) : null}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-faint">
                    Patterns
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
                    <p className="mt-0.5 text-xs text-rose-300">
                      {pattern.error}
                    </p>
                  ) : null}
                </div>
              </div>

              {play?.active ? (
                <p className="text-sm text-muted">
                  Live · combo {play.combo ?? 0}
                  {play.maxCombo != null ? ` / ${play.maxCombo}` : ""}
                  {" · "}
                  {play.accuracy != null
                    ? formatAccuracy(play.accuracy)
                    : "—"}
                  {" · "}
                  {play.misses ?? 0} miss
                  {play.pp != null ? ` · ${Math.round(play.pp)}pp` : ""}
                </p>
              ) : (
                <p className="text-sm text-faint">
                  {beatmap?.state ? `State: ${beatmap.state}` : "Song select"}
                </p>
              )}

              {data?.matchedBeatmapId ? (
                <Link
                  to="/practice/$beatmapId"
                  params={{ beatmapId: data.matchedBeatmapId }}
                  className="inline-flex text-sm text-accent hover:underline"
                >
                  Open practice profile →
                </Link>
              ) : (
                <p className="text-xs text-faint">
                  Map not in Roxysu library yet — showing ephemeral analysis.
                </p>
              )}
            </div>
          ) : data?.enabled && data.status === "connected" ? (
            <p className="text-sm text-muted">
              Waiting for a selected map from osu!…
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
