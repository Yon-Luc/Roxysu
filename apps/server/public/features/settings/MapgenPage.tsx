import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DAN_PRESETS, resolveDanPreset } from "@roxysu/mapgen-core";
import { PageTitle } from "../../components/PageTitle";
import { fetchMapgenStatus, generateMapgenPack } from "../../lib/api";

type PatternKey =
  | "delay"
  | "jack"
  | "chordjack"
  | "chordstream"
  | "bracket"
  | "ln";

const PATTERN_FIELDS: Array<{
  key: PatternKey;
  label: string;
  hint: string;
  defaultValue: number;
}> = [
  {
    key: "delay",
    label: "Delay",
    hint: "Single-note 7K streams",
    defaultValue: 0.45,
  },
  {
    key: "jack",
    label: "Jack",
    hint: "Same-column repeats",
    defaultValue: 0.15,
  },
  {
    key: "chordjack",
    label: "Chordjack",
    hint: "Chords mixed with jacks",
    defaultValue: 0.15,
  },
  {
    key: "chordstream",
    label: "Chordstream",
    hint: "3-note chord streams",
    defaultValue: 0.1,
  },
  {
    key: "bracket",
    label: "Bracket",
    hint: "Outer-column X patterns",
    defaultValue: 0.1,
  },
  {
    key: "ln",
    label: "LN %",
    hint: "Share of notes as long notes",
    defaultValue: 0.15,
  },
];

function defaultTargets(): Record<PatternKey, number> {
  return Object.fromEntries(
    PATTERN_FIELDS.map((f) => [f.key, f.defaultValue]),
  ) as Record<PatternKey, number>;
}

function targetsFromDan(danId: string): Record<PatternKey, number> | null {
  const preset = resolveDanPreset(danId);
  if (!preset) return null;
  const bias = preset.patternBias;
  return {
    delay: bias.delay ?? 0,
    jack: bias.jack ?? 0,
    chordjack: bias.chordjack ?? 0,
    chordstream: bias.chordstream ?? 0,
    bracket: bias.bracket ?? 0,
    ln: preset.ln,
  };
}

type DropZoneProps = {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  previewUrl?: string | null;
  onFile: (file: File | null) => void;
};

function DropZone({
  label,
  hint,
  accept,
  file,
  previewUrl,
  onFile,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) onFile(dropped);
    },
    [onFile],
  );

  return (
    <label
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative flex min-h-36 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed px-4 py-6 text-center transition ${
        dragging
          ? "border-accent bg-accent-glow"
          : "border-line bg-elevated/40 hover:border-accent/50 hover:bg-elevated"
      }`}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-40"
        />
      ) : null}
      <div className="relative z-10 space-y-1">
        <div className="text-sm font-bold text-ink">{label}</div>
        <div className="text-xs text-muted">{hint}</div>
        {file ? (
          <div className="mt-2 font-mono text-xs text-accent">{file.name}</div>
        ) : (
          <div className="mt-2 text-xs text-faint">Drop or click to choose</div>
        )}
      </div>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function SliderField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="font-mono text-xs tabular-nums text-subtle">
          {Math.round(value * 100)}%
        </span>
      </div>
      <p className="mt-0.5 text-xs text-faint">{hint}</p>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="mt-2 w-full accent-[var(--color-accent)]"
      />
    </label>
  );
}

export function MapgenPage() {
  const statusQuery = useQuery({
    queryKey: ["mapgen", "status"],
    queryFn: fetchMapgenStatus,
  });

  const [audio, setAudio] = useState<File | null>(null);
  const [background, setBackground] = useState<File | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [creator, setCreator] = useState("Roxysu Mapgen");
  const [version, setVersion] = useState("Generated");
  const [bpm, setBpm] = useState("");
  const [seed, setSeed] = useState("");
  const [endSec, setEndSec] = useState("");
  const [dan, setDan] = useState("");
  const [targets, setTargets] = useState<Record<PatternKey, number>>(defaultTargets);

  const [lastResult, setLastResult] = useState<{
    filename: string;
    bpm: string | null;
    notes: string | null;
    dominant: string | null;
    offsetMs: string | null;
    bpmConfidence: string | null;
    bpmAlts: string | null;
    danTarget: string | null;
    estDiff: string | null;
    sunnyStar: string | null;
    lnPct: string | null;
    sunnyLnPct: string | null;
    timingPoints: string | null;
    bpmMap: string | null;
  } | null>(null);

  useEffect(() => {
    if (!background) {
      setBgPreview(null);
      return;
    }
    const url = URL.createObjectURL(background);
    setBgPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [background]);

  useEffect(() => {
    if (audio && !title) {
      setTitle(audio.name.replace(/\.[^.]+$/, ""));
    }
  }, [audio, title]);

  const patternSum = useMemo(() => {
    const { ln: _ln, ...rest } = targets;
    return Object.values(rest).reduce((a, b) => a + b, 0);
  }, [targets]);

  const generate = useMutation({
    mutationFn: () => {
      if (!audio) throw new Error("Drop an audio file first");
      return generateMapgenPack({
        audio,
        background: background ?? undefined,
        title: title || undefined,
        artist: artist || undefined,
        creator: creator || undefined,
        version: version || undefined,
        delay: targets.delay,
        jack: targets.jack,
        chordjack: targets.chordjack,
        chordstream: targets.chordstream,
        bracket: targets.bracket,
        ln: targets.ln,
        bpm: bpm ? Number(bpm) : undefined,
        seed: seed ? Number(seed) : undefined,
        endSec: endSec ? Number(endSec) : undefined,
        dan: dan || undefined,
      });
    },
    onSuccess: (result) => {
      setLastResult({
        filename: result.filename,
        bpm: result.bpm,
        notes: result.notes,
        dominant: result.dominant,
        offsetMs: result.offsetMs,
        bpmConfidence: result.bpmConfidence,
        bpmAlts: result.bpmAlts,
        danTarget: result.danTarget,
        estDiff: result.estDiff,
        sunnyStar: result.sunnyStar,
        lnPct: result.lnPct,
        sunnyLnPct: result.sunnyLnPct,
        timingPoints: result.timingPoints,
        bpmMap: result.bpmMap,
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const applyDan = (nextDan: string) => {
    setDan(nextDan);
    if (!nextDan) return;
    const next = targetsFromDan(nextDan);
    if (!next) return;
    setTargets(next);
    const preset = resolveDanPreset(nextDan);
    if (preset) setVersion(preset.label);
  };

  const ffmpegOk = statusQuery.data?.ffmpegAvailable === true;

  return (
    <div className="space-y-8">
      <div>
        <Link to="/settings" className="rx-back">
          ← Settings
        </Link>
        <PageTitle className="mt-3">Mapgen</PageTitle>
        <p className="rx-subtitle">
          Drop an MP3, tune pattern targets, optionally add a background, and
          download a playable 7K beatmap pack (.osz).
        </p>
      </div>

      {!statusQuery.isLoading && !ffmpegOk ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {statusQuery.data?.message ??
            "ffmpeg is not available — music analysis cannot run."}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <DropZone
          label="Audio"
          hint="mp3, ogg, wav, flac"
          accept="audio/*,.mp3,.ogg,.wav,.flac,.m4a"
          file={audio}
          onFile={setAudio}
        />
        <DropZone
          label="Background (optional)"
          hint="jpg, png, webp"
          accept="image/*,.jpg,.jpeg,.png,.webp"
          file={background}
          previewUrl={bgPreview}
          onFile={setBackground}
        />
      </section>

      {background ? (
        <button
          type="button"
          className="rx-btn text-xs"
          onClick={() => setBackground(null)}
        >
          Clear background
        </button>
      ) : null}

      <section className="rx-panel p-5">
        <h2 className="text-sm font-bold text-ink">Metadata</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Artist" value={artist} onChange={setArtist} />
          <Field label="Creator" value={creator} onChange={setCreator} />
          <Field label="Difficulty" value={version} onChange={setVersion} />
          <Field
            label="BPM override"
            value={bpm}
            onChange={setBpm}
            placeholder="auto-detect"
            mono
          />
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              Dan target
            </span>
            <select
              value={dan}
              onChange={(e) => applyDan(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            >
              <option value="">None (manual mix)</option>
              <optgroup label="7K Regular (RC)">
                {DAN_PRESETS.filter((p) => p.axis === "rc").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} (~{p.targetStar.toFixed(1)}★)
                  </option>
                ))}
              </optgroup>
              <optgroup label="7K LN">
                {DAN_PRESETS.filter((p) => p.axis === "ln").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} (~{p.targetStar.toFixed(1)}★)
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="mt-1 text-xs text-faint">
              Sets density, LN floor, and pattern bias. Exact Sunny dan still
              varies with song length.
            </p>
          </label>
          <Field
            label="Seed"
            value={seed}
            onChange={setSeed}
            placeholder="random"
            mono
          />
          <Field
            label="End after (seconds)"
            value={endSec}
            onChange={setEndSec}
            placeholder="full track"
            mono
          />
        </div>
      </section>

      <section className="rx-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">Pattern targets</h2>
          <span className="text-xs text-faint">
            Pattern mix sum {Math.round(patternSum * 100)}% (auto-normalized) ·
            LN separate
          </span>
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {PATTERN_FIELDS.map((field) => (
            <SliderField
              key={field.key}
              label={field.label}
              hint={field.hint}
              value={targets[field.key]}
              onChange={(v) =>
                setTargets((prev) => ({ ...prev, [field.key]: v }))
              }
            />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={!audio || !ffmpegOk || generate.isPending}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? "Generating…" : "Generate & download .osz"}
        </button>
        {audio ? (
          <button
            type="button"
            className="rx-btn"
            disabled={generate.isPending}
            onClick={() => setAudio(null)}
          >
            Clear audio
          </button>
        ) : null}
      </div>

      {generate.error ? (
        <p className="text-sm text-rose-300">{generate.error.message}</p>
      ) : null}

      {lastResult ? (
        <section className="rx-panel p-5 text-sm text-subtle">
          <h2 className="text-sm font-bold text-ink">Last pack</h2>
          <p className="mt-2 font-mono text-xs text-accent">
            {lastResult.filename}
          </p>
          <p className="mt-2">
            {lastResult.bpm ? `${lastResult.bpm} BPM` : "BPM n/a"}
            {lastResult.bpmConfidence
              ? ` (${lastResult.bpmConfidence}% conf)`
              : ""}
            {lastResult.bpmAlts ? ` · alts ${lastResult.bpmAlts}` : ""}
            {lastResult.offsetMs != null
              ? ` · offset ${lastResult.offsetMs}ms`
              : ""}
            {lastResult.notes ? ` · ${lastResult.notes} notes` : ""}
            {lastResult.lnPct != null ? ` · LN target ${lastResult.lnPct}%` : ""}
            {lastResult.sunnyLnPct != null
              ? ` · Sunny LN ${lastResult.sunnyLnPct}%`
              : ""}
          </p>
          <p className="mt-1">
            {lastResult.timingPoints
              ? `${lastResult.timingPoints} timing point${lastResult.timingPoints === "1" ? "" : "s"}`
              : "Timing n/a"}
            {lastResult.bpmMap ? ` · ${lastResult.bpmMap}` : ""}
          </p>
          <p className="mt-1">
            {lastResult.danTarget
              ? `Target ${lastResult.danTarget}`
              : "No dan target"}
            {lastResult.estDiff
              ? ` · Sunny says ${lastResult.estDiff}`
              : ""}
            {lastResult.sunnyStar ? ` (${lastResult.sunnyStar}★)` : ""}
            {lastResult.dominant
              ? ` · dominant ${lastResult.dominant}`
              : ""}
          </p>
          <p className="mt-2 text-xs text-faint">
            Import the .osz in osu!lazer (File → Import). Roxysu picks it up
            from lazer&apos;s library on the next sync (~60s) — it does not
            scan a Songs folder. If BPM looks half/double, paste an alt above
            and regenerate.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-faint">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
