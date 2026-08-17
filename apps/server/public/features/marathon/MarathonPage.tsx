import { useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { BeatmapCover } from "../../components/BeatmapCover";
import {
  fetchMarathonSources,
  fetchPracticeList,
  fetchPracticeRecommend,
  openMarathonInOsu,
  type MarathonSource,
  type RecommendFocus,
  type RecommendSkillset,
} from "../../lib/api";
import {
  generateMarathonOsz,
  type MarathonExportProgress,
} from "../../lib/marathonExport";
import { useAppDict, t } from "../../lib/i18n";
import { pushToast } from "../../lib/toasts";
import { formatStars } from "../../lib/format";

const MAX_MAPS = 12;
const DEFAULT_PAUSE_MS = 2000;
const FOCUS_OPTIONS: RecommendFocus[] = [
  "push",
  "accuracy",
  "consistency",
  "deficit",
  "skillset",
];
const AXIS_OPTIONS: RecommendSkillset[] = ["both", "rc", "ln", "fln"];

function parseIdsParam(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_MAPS);
}

function parseKeyParam(raw: unknown): 4 | 7 | null {
  const n = Number(raw);
  return n === 4 || n === 7 ? n : null;
}

function progressLabel(
  p: MarathonExportProgress,
  dict: ReturnType<typeof useAppDict>["dict"],
): string {
  if (p.phase === "audio") {
    return (
      t(dict?.marathon.progressAudio, {
        current: String(p.index + 1),
        total: String(p.total),
      }) || `Decoding audio ${p.index + 1}/${p.total}`
    );
  }
  if (p.phase === "encode") return dict?.marathon.progressEncode ?? "Encoding audio…";
  if (p.phase === "collage") return dict?.marathon.progressCollage ?? "Building collage…";
  if (p.phase === "pack") return dict?.marathon.progressPack ?? "Packing map…";
  if (p.phase === "import") return dict?.marathon.progressImport ?? "Opening in osu!…";
  return dict?.marathon.progressDone ?? "Done";
}

export function MarathonPage() {
  const { dict } = useAppDict();
  const navigate = useNavigate();
  const search = useRouterState({
    select: (s) => s.location.search as { ids?: string; key?: number },
  });
  const initialIds = useMemo(() => parseIdsParam(search.ids), [search.ids]);
  const initialKey = parseKeyParam(search.key);

  const [tracks, setTracks] = useState<MarathonSource[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("Various Artists");
  const [version, setVersion] = useState("");
  const [pauseMs, setPauseMs] = useState(DEFAULT_PAUSE_MS);
  const [recKey, setRecKey] = useState<4 | 7>(initialKey ?? 7);
  const [recFocus, setRecFocus] = useState<RecommendFocus>("push");
  const [recSkillset, setRecSkillset] = useState<RecommendSkillset>("both");
  const [recCount, setRecCount] = useState(4);
  const [progress, setProgress] = useState<MarathonExportProgress | null>(null);

  const keyCount = tracks.find((t) => t.keyCount != null)?.keyCount ?? null;

  useEffect(() => {
    const tmr = window.setTimeout(() => setDebouncedQ(searchQ.trim()), 250);
    return () => window.clearTimeout(tmr);
  }, [searchQ]);

  useEffect(() => {
    if (initialIds.length === 0) return;
    let cancelled = false;
    void fetchMarathonSources(initialIds)
      .then((data) => {
        if (cancelled) return;
        setTracks(data.sources.filter(isPlayableSource));
        if (data.keyCount) setRecKey(data.keyCount === 4 ? 4 : 7);
      })
      .catch(() => {
        if (!cancelled) {
          pushToast({
            title: dict?.marathon.loadFailed ?? "Could not load maps",
            tone: "error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialIds.join(","), dict?.marathon.loadFailed]);

  useEffect(() => {
    if (!title && tracks.length > 0) {
      const first = tracks[0]!;
      setTitle(
        `${first.artist ?? "Unknown"} Marathon`.slice(0, 80),
      );
    }
    if (!version && keyCount) setVersion(`${keyCount}K`);
  }, [tracks, title, version, keyCount]);

  const searchQuery = [
    "mode=mania",
    keyCount ? `key=${keyCount}` : "",
    debouncedQ,
  ]
    .filter(Boolean)
    .join(" ");

  const searchResults = useQuery({
    queryKey: ["marathon-search", searchQuery],
    queryFn: () =>
      fetchPracticeList({ page: 1, pageSize: 8, q: searchQuery }),
    enabled: debouncedQ.length > 0,
  });

  const recommend = useQuery({
    queryKey: ["marathon-recommend", recKey, recFocus, recSkillset, recCount],
    queryFn: () =>
      fetchPracticeRecommend({
        focus: recFocus,
        skillset: recFocus === "deficit" ? undefined : recSkillset,
        count: recCount,
        keyCount: recKey,
      }),
  });

  const recItems =
    recommend.data && !("error" in recommend.data)
      ? recommend.data.recommendations
      : [];

  const addIds = useMutation({
    mutationFn: async (ids: string[]) => {
      const unique = ids.filter((id) => !tracks.some((t) => t.id === id));
      if (unique.length === 0) return [] as MarathonSource[];
      if (tracks.length + unique.length > MAX_MAPS) {
        throw new Error(
          t(dict?.marathon.tooMany, { max: String(MAX_MAPS) }) ||
            `At most ${MAX_MAPS} maps`,
        );
      }
      const data = await fetchMarathonSources(unique);
      return data.sources.filter(isPlayableSource);
    },
    onSuccess: (sources) => {
      setTracks((prev) => {
        const next = [...prev];
        for (const src of sources) {
          if (!next.some((t) => t.id === src.id)) next.push(src);
        }
        return next.slice(0, MAX_MAPS);
      });
    },
    onError: (err: Error) => {
      pushToast({
        title: dict?.marathon.addFailed ?? "Could not add maps",
        detail: err.message,
        tone: "error",
      });
    },
  });

  const fillRecommend = useMutation({
    mutationFn: async () => {
      const ids = recItems.map((item) => item.id).slice(0, recCount);
      if (ids.length < 2) {
        throw new Error(
          dict?.marathon.needRecommend ?? "Need at least two recommended maps",
        );
      }
      const data = await fetchMarathonSources(ids);
      return data.sources.filter(isPlayableSource);
    },
    onSuccess: (sources) => {
      setTracks(sources);
      setTitle("");
      setVersion(`${recKey}K`);
      void navigate({
        to: "/marathon",
        search: { ids: sources.map((s) => s.id).join(","), key: recKey },
      });
    },
    onError: (err: Error) => {
      pushToast({
        title: dict?.marathon.addFailed ?? "Could not add maps",
        detail: err.message,
        tone: "error",
      });
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const ready = tracks.filter(
        (t) => t.osuText && t.audioFileHash && !t.error,
      );
      if (ready.length < 2) {
        throw new Error(
          dict?.marathon.needTwo ?? "Add at least two playable mania maps",
        );
      }
      const keys = new Set(ready.map((t) => t.keyCount));
      if (keys.size > 1) {
        throw new Error(
          dict?.marathon.sameKeys ?? "All maps must use the same key count",
        );
      }
      const packed = await generateMarathonOsz({
        sources: ready.map((t) => ({
          osuText: t.osuText!,
          audioFileHash: t.audioFileHash!,
          backgroundFileHash: t.backgroundFileHash,
        })),
        pauseMs,
        title: title.trim() || "Marathon",
        artist: artist.trim() || "Various Artists",
        version: version.trim() || `${keyCount ?? ""}K`,
        onProgress: setProgress,
      });
      setProgress({ phase: "import" });
      await openMarathonInOsu(packed.blob, packed.filename);
      return packed.filename;
    },
    onSuccess: (filename) => {
      setProgress({ phase: "done" });
      pushToast({
        title: dict?.marathon.opened ?? "Opened in osu!",
        detail: filename,
        tone: "success",
      });
      window.setTimeout(() => setProgress(null), 800);
    },
    onError: (err: Error) => {
      setProgress(null);
      if (err.name === "AbortError") return;
      pushToast({
        title: dict?.marathon.generateFailed ?? "Generate failed",
        detail: err.message,
        tone: "error",
      });
    },
  });

  const searchItems =
    searchResults.data && !("error" in searchResults.data)
      ? searchResults.data.items
      : [];

  const canGenerate =
    tracks.filter((t) => t.osuText && t.audioFileHash && !t.error).length >= 2 &&
    !generate.isPending;

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>{dict?.nav.marathon ?? "Marathon"}</PageTitle>
        <p className="mt-1 text-sm text-muted">
          {dict?.marathon.subtitle ??
            "Fuse mania maps into one chart with a short pause and a grid collage, then open it in osu!lazer."}
        </p>
      </div>

      <section className="rx-panel space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[12rem] flex-1 text-sm">
            <span className="rx-label">{dict?.marathon.title ?? "Title"}</span>
            <input
              className="rx-input mt-1 w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="min-w-[10rem] flex-1 text-sm">
            <span className="rx-label">{dict?.marathon.artist ?? "Artist"}</span>
            <input
              className="rx-input mt-1 w-full"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
            />
          </label>
          <label className="w-28 text-sm">
            <span className="rx-label">{dict?.marathon.version ?? "Version"}</span>
            <input
              className="rx-input mt-1 w-full"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <label className="w-44 text-sm">
            <span className="rx-label">
              {t(dict?.marathon.pause, { ms: String(pauseMs) }) ||
                `Pause ${pauseMs} ms`}
            </span>
            <input
              type="range"
              className="mt-2 w-full"
              min={0}
              max={5000}
              step={100}
              value={pauseMs}
              onChange={(e) => setPauseMs(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          type="button"
          className="rx-btn-primary"
          disabled={!canGenerate}
          onClick={() => generate.mutate()}
        >
          {generate.isPending
            ? (dict?.marathon.generating ?? "Generating…")
            : (dict?.marathon.generate ?? "Generate and open in osu!")}
        </button>
        {progress ? (
          <p className="text-sm text-muted">{progressLabel(progress, dict)}</p>
        ) : null}
      </section>

      <section className="rx-panel space-y-3 p-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          {t(dict?.marathon.tracks, { count: String(tracks.length) }) ||
            `Tracks (${tracks.length})`}
        </h2>
        {tracks.length === 0 ? (
          <p className="text-sm text-muted">
            {dict?.marathon.empty ??
              "Add maps from search or fill from 4K/7K recommend."}
          </p>
        ) : (
          <ul className="space-y-1">
            {tracks.map((track, index) => (
              <li
                key={track.id}
                className="flex items-center gap-2 rounded-md bg-elevated/50 px-2 py-1.5"
              >
                <BeatmapCover
                  backgroundFileHash={track.backgroundFileHash}
                  setOnlineId={track.setOnlineId}
                  size="list"
                  className="h-10 w-10 shrink-0 rounded"
                  alt=""
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">
                    {track.artist ?? "Unknown"} — {track.title ?? "Untitled"}
                    {track.difficultyName ? ` [${track.difficultyName}]` : ""}
                  </div>
                  <div className="text-xs text-faint">
                    {track.keyCount ? `${track.keyCount}K · ` : ""}
                    {formatStars(track.starRating)}
                    {track.error ? ` · ${track.error}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="rx-btn px-2"
                    disabled={index === 0}
                    onClick={() =>
                      setTracks((prev) => moveTrack(prev, index, -1))
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rx-btn px-2"
                    disabled={index === tracks.length - 1}
                    onClick={() =>
                      setTracks((prev) => moveTrack(prev, index, 1))
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="rx-btn px-2"
                    onClick={() =>
                      setTracks((prev) => prev.filter((t) => t.id !== track.id))
                    }
                  >
                    {dict?.marathon.remove ?? "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {tracks.length > 0 ? (
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
            {tracks.map((track) => (
              <BeatmapCover
                key={`bg-${track.id}`}
                backgroundFileHash={track.backgroundFileHash}
                setOnlineId={track.setOnlineId}
                size="card"
                className="aspect-video w-full rounded"
                alt=""
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="rx-panel space-y-3 p-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          {dict?.marathon.addMaps ?? "Add maps"}
        </h2>
        <input
          className="rx-input w-full"
          placeholder={
            dict?.marathon.searchPlaceholder ??
            "Search practice library (mania)"
          }
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        {searchItems.length > 0 ? (
          <ul className="space-y-1">
            {searchItems.map((item) => {
              const added = tracks.some((t) => t.id === item.id);
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-md px-1 py-1"
                >
                  <BeatmapCover
                    backgroundFileHash={item.backgroundFileHash}
                    setOnlineId={item.setOnlineId}
                    size="list"
                    className="h-8 w-8 shrink-0 rounded"
                    alt=""
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {item.artist} — {item.title} [{item.difficultyName}]
                  </span>
                  <button
                    type="button"
                    className="rx-btn"
                    disabled={added || addIds.isPending}
                    onClick={() => addIds.mutate([item.id])}
                  >
                    {added
                      ? (dict?.marathon.added ?? "Added")
                      : (dict?.marathon.add ?? "Add")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="rx-panel space-y-3 p-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          {dict?.marathon.fromRecommend ?? "Fill from recommend"}
        </h2>
        <div className="flex flex-wrap gap-2">
          {([4, 7] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={
                recKey === k
                  ? "rx-chip bg-accent-glow text-accent"
                  : "rx-chip bg-elevated text-muted hover:text-ink"
              }
              onClick={() => setRecKey(k)}
            >
              {k}K
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {FOCUS_OPTIONS.map((id) => (
            <button
              key={id}
              type="button"
              className={
                recFocus === id
                  ? "rx-chip bg-accent-glow text-accent"
                  : "rx-chip bg-elevated text-muted hover:text-ink"
              }
              onClick={() => setRecFocus(id)}
            >
              {dict?.session.focus[id] ?? id}
            </button>
          ))}
        </div>
        {recFocus !== "deficit" ? (
          <div className="flex flex-wrap gap-2">
            {AXIS_OPTIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={
                  recSkillset === id
                    ? "rx-chip bg-accent-glow text-accent"
                    : "rx-chip bg-elevated text-muted hover:text-ink"
                }
                onClick={() => setRecSkillset(id)}
              >
                {
                  {
                    both: dict?.stats.axisAll ?? "All",
                    rc: dict?.stats.axisRice ?? "Rice",
                    ln: dict?.stats.axisLn ?? "LN",
                    fln: dict?.stats.axisFln ?? "FLN",
                  }[id]
                }
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rx-label">{dict?.marathon.count ?? "Count"}</span>
          {[4, 6, 8, 10].map((n) => (
            <button
              key={n}
              type="button"
              className={
                recCount === n
                  ? "rx-chip bg-accent-glow text-accent"
                  : "rx-chip bg-elevated text-muted hover:text-ink"
              }
              onClick={() => setRecCount(n)}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            className="rx-btn"
            disabled={fillRecommend.isPending || recItems.length < 2}
            onClick={() => fillRecommend.mutate()}
          >
            {fillRecommend.isPending
              ? (dict?.marathon.filling ?? "Filling…")
              : (dict?.marathon.useRecommend ?? "Use these maps")}
          </button>
        </div>
        <p className="text-xs text-faint">
          {recommend.data && !("error" in recommend.data)
            ? recommend.data.summary
            : null}
          {recItems.length > 0
            ? ` · ${recItems.length} ${dict?.marathon.maps ?? "maps"}`
            : ""}
        </p>
      </section>
    </div>
  );
}

function isPlayableSource(source: MarathonSource): boolean {
  return Boolean(source.osuText && source.audioFileHash && !source.error);
}

function moveTrack(
  tracks: MarathonSource[],
  index: number,
  delta: number,
): MarathonSource[] {
  const next = index + delta;
  if (next < 0 || next >= tracks.length) return tracks;
  const copy = [...tracks];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item!);
  return copy;
}
