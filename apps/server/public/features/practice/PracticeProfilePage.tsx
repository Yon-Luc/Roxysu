import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "../../components/BeatmapCover";
import { fetchBeatmap } from "../../lib/api";
import {
  formatAccuracy,
  formatMods,
  formatPp,
  formatRelativeTime,
  formatStars,
  osuClientBeatmapUrl,
  osuWebBeatmapUrl,
} from "../../lib/format";

export function PracticeProfilePage({ beatmapId }: { beatmapId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["beatmap", beatmapId],
    queryFn: () => fetchBeatmap(beatmapId),
    enabled: Boolean(beatmapId),
  });

  if (isLoading) {
    return <p className="text-muted">Loading practice profile…</p>;
  }

  if (error || !data || !("beatmap" in data) || !data.beatmap) {
    return (
      <div className="space-y-3">
        <Link to="/practice" className="rx-back">
          ← Practice
        </Link>
        <p className="text-rose-300">
          {error?.message ?? "Beatmap not found"}
        </p>
      </div>
    );
  }

  const beatmap = data.beatmap;
  const stats = data.stats!;
  const recentScores = data.recentScores ?? [];
  const mastery = data.mastery;
  const sessions = data.sessions ?? [];
  const clientUrl = osuClientBeatmapUrl(beatmap.onlineId);
  const webUrl = osuWebBeatmapUrl(beatmap.onlineId, beatmap.setOnlineId);

  return (
    <div className="space-y-8">
      <div>
        <Link to="/practice" className="rx-back">
          ← Practice
        </Link>
        <div className="relative mt-4 overflow-hidden rounded-xl">
          <BeatmapCover
            backgroundFileHash={beatmap.backgroundFileHash}
            setOnlineId={beatmap.setOnlineId}
            size="cover"
            className="aspect-[21/9] w-full max-h-64 sm:max-h-72"
            alt=""
          />
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <p className="text-sm font-medium text-subtle">
              {beatmap.artist}
            </p>
            <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              {beatmap.title}
            </h1>
            <p className="mt-2 text-sm text-muted">
              [{beatmap.difficultyName}] · {formatStars(beatmap.starRating)} ·{" "}
              {beatmap.bpm.toFixed(0)} BPM
              {beatmap.mapperUsername
                ? ` · mapped by ${beatmap.mapperUsername}`
                : ""}
            </p>
            {(clientUrl || webUrl) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {clientUrl && (
                  <a href={clientUrl} className="rx-btn-primary">
                    Open in osu!
                  </a>
                )}
                {webUrl && (
                  <a
                    href={webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rx-btn"
                  >
                    View on website
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Plays" value={String(stats.playCount)} />
        <MiniStat label="Best acc" value={formatAccuracy(stats.bestAccuracy)} />
        <MiniStat label="Best PP" value={formatPp(stats.bestPp)} />
        <MiniStat
          label="Last played"
          value={formatRelativeTime(stats.lastPlayedAt)}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rx-panel px-5 py-5">
          <h3 className="text-sm font-bold text-ink">Mastery</h3>
          {mastery ? (
            <div className="mt-3 space-y-1">
              <div className="font-display text-4xl font-extrabold tabular-nums text-accent">
                {mastery.level.toFixed(1)}
              </div>
              <p className="text-xs text-muted">
                Formula: {mastery.formulaId} · {mastery.playCount} plays
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-faint">No mastery yet.</p>
          )}
        </div>
        <div className="rx-panel px-5 py-5">
          <h3 className="text-sm font-bold text-ink">Sessions</h3>
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-faint">No sessions linked.</p>
          ) : (
            <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/sessions/$sessionId"
                    params={{
                      sessionId:
                        s.endedAt == null ? "current" : String(s.id),
                    }}
                    className="rx-row justify-between !px-2 !py-1.5 text-sm"
                  >
                    <span className="text-subtle">
                      {formatRelativeTime(s.startedAt)}
                    </span>
                    <span className="tabular-nums text-muted">
                      {s.scoreCount} plays
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl font-bold tracking-tight text-ink">
          Score timeline
        </h2>
        {recentScores.length === 0 ? (
          <p className="text-sm text-muted">No scores on this map yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {recentScores.map((score) => (
              <li key={score.id} className="rx-row justify-between">
                <div className="text-sm text-subtle">
                  {formatRelativeTime(score.playedAt)} · {formatMods(score.mods)}
                </div>
                <div className="flex gap-4 text-sm font-semibold tabular-nums text-ink">
                  <span>{formatAccuracy(score.accuracy)}</span>
                  <span className="text-subtle">{formatPp(score.pp)}</span>
                  <span className="text-muted">{score.maxCombo}x</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rx-stat">
      <div className="rx-label">{label}</div>
      <div className="mt-1.5 text-lg font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}
