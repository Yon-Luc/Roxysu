import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
    return <p className="text-[#8b93a7]">Loading practice profile…</p>;
  }

  if (error || !data || !("beatmap" in data) || !data.beatmap) {
    return (
      <div className="space-y-3">
        <Link to="/practice" className="text-sm text-[#8b93a7] hover:text-white">
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
        <Link to="/practice" className="text-sm text-[#8b93a7] hover:text-white">
          ← Practice
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">
          {beatmap.artist} — {beatmap.title}
        </h1>
        <p className="mt-1 text-[#a8b0c0]">
          [{beatmap.difficultyName}] · {formatStars(beatmap.starRating)} ·{" "}
          {beatmap.bpm.toFixed(0)} BPM
          {beatmap.mapperUsername ? ` · mapped by ${beatmap.mapperUsername}` : ""}
        </p>
        {(clientUrl || webUrl) && (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {clientUrl && (
              <a
                href={clientUrl}
                className="text-[#7eb8ff] hover:text-white"
              >
                Open in osu!
              </a>
            )}
            {webUrl && (
              <a
                href={webUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#8b93a7] hover:text-white"
              >
                View on website
              </a>
            )}
          </div>
        )}
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
        <div className="rounded-lg border border-white/10 bg-[#151922] px-4 py-4">
          <h3 className="text-sm font-medium text-[#a8b0c0]">Mastery</h3>
          {mastery ? (
            <div className="mt-2 space-y-1">
              <div className="text-3xl font-semibold tabular-nums text-white">
                {mastery.level.toFixed(1)}
              </div>
              <p className="text-xs text-[#8b93a7]">
                Formula: {mastery.formulaId} · {mastery.playCount} plays
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[#6b7385]">No mastery yet.</p>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-[#151922] px-4 py-4">
          <h3 className="text-sm font-medium text-[#a8b0c0]">Sessions</h3>
          {sessions.length === 0 ? (
            <p className="mt-2 text-sm text-[#6b7385]">No sessions linked.</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/sessions/$sessionId"
                    params={{
                      sessionId:
                        s.endedAt == null ? "current" : String(s.id),
                    }}
                    className="flex justify-between gap-2 text-[#a8b0c0] hover:text-white"
                  >
                    <span>{formatRelativeTime(s.startedAt)}</span>
                    <span className="tabular-nums">{s.scoreCount} plays</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-[#8b93a7]">
          Score timeline
        </h2>
        {recentScores.length === 0 ? (
          <p className="text-sm text-[#8b93a7]">No scores on this map yet.</p>
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-[#151922]">
            {recentScores.map((score) => (
              <li
                key={score.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="text-sm text-[#a8b0c0]">
                  {formatRelativeTime(score.playedAt)} · {formatMods(score.mods)}
                </div>
                <div className="flex gap-4 text-sm tabular-nums text-white">
                  <span>{formatAccuracy(score.accuracy)}</span>
                  <span className="text-[#a8b0c0]">{formatPp(score.pp)}</span>
                  <span className="text-[#8b93a7]">{score.maxCombo}x</span>
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
    <div className="rounded-lg border border-white/10 bg-[#151922] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-[#8b93a7]">
        {label}
      </div>
      <div className="mt-0.5 font-medium tabular-nums text-white">{value}</div>
    </div>
  );
}
