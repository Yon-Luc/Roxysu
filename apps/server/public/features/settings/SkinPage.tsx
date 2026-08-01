import { useEffect, useMemo, useRef, useState } from "react";
import { PageTitle } from "../../components/PageTitle";
import { ManiaNotefield } from "../../components/ManiaNotefield";
import {
  KEYMODES,
  LN_TAIL_SHAPES,
  NOTE_ORIENTATIONS,
  NOTE_SHAPES,
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
  defaultKeymodeSkin,
  getPreviewSkin,
  resetKeymodeSkin,
  resetPreviewSkin,
  setPreviewSkin,
  usePreviewSkin,
  type ColumnSkin,
  type Keymode,
  type LnTailShape,
  type NoteOrientation,
  type NoteShape,
} from "../../lib/previewSkin";

function buildSampleNotes(keys: number) {
  const notes: { column: number; startMs: number; endMs: number }[] = [];

  const pattern = [0, 1, 2, keys - 1, Math.floor(keys / 2), 0, keys - 2, 1];

  const totalNotes = 48;
  const spacing = 140;

  const holdDuration = 420;
  const releaseGap = 40;
  const minLongNotes = 10;

  const nextAvailable = Array(keys).fill(0);

  let t = 400;
  let longNotes = 0;

  for (let i = 0; i < totalNotes; i++) {
    const remaining = totalNotes - i;

    const mustMakeLong =
      longNotes < minLongNotes && remaining <= minLongNotes - longNotes;

    const wantsLong = mustMakeLong || i % 5 === 0;

    const preferred = pattern[i % pattern.length]! % keys;

    let column = -1;

    for (let offset = 0; offset < keys; offset++) {
      const c = (preferred + offset) % keys;

      if (t >= nextAvailable[c]) {
        column = c;
        break;
      }
    }

    if (column === -1) {
      t += spacing;
      i--;
      continue;
    }

    const endMs = wantsLong ? t + holdDuration : t;

    notes.push({
      column,
      startMs: t,
      endMs,
    });

    if (wantsLong) {
      longNotes++;
      nextAvailable[column] = endMs + releaseGap;
    } else {
      nextAvailable[column] = t;
    }

    if (!wantsLong && i % 3 === 2) {
      const chordCol = (column + 2) % keys;

      if (t >= nextAvailable[chordCol]) {
        notes.push({
          column: chordCol,
          startMs: t,
          endMs: t,
        });

        nextAvailable[chordCol] = t;
      }
    }

    t += spacing;
  }

  return notes;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState(value.toUpperCase());
  const hex = value.toUpperCase();

  useEffect(() => {
    setDraft(hex);
  }, [hex]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copyHex() {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
    } catch {
      // Clipboard may be denied.
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded bg-transparent"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={draft}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const next = e.target.value.trim();
            setDraft(next.toUpperCase());
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => setDraft(hex)}
          className="rx-input h-8 min-w-0 flex-1 font-mono text-xs uppercase"
          aria-label={`${label} hex value`}
        />
        <button
          type="button"
          className="rx-btn h-8 shrink-0 px-2 text-xs"
          title={`Copy ${hex}`}
          onClick={() => void copyHex()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function SkinPage() {
  const skin = usePreviewSkin();
  const [keys, setKeys] = useState<Keymode>(7);
  const [previewTimeMs, setPreviewTimeMs] = useState(800);
  const [playing, setPlaying] = useState(true);
  const timeRef = useRef(previewTimeMs);
  timeRef.current = previewTimeMs;

  const keySkin = skin.keymodes[keys];
  const sampleNotes = useMemo(() => buildSampleNotes(keys), [keys]);
  const isArrow = keySkin.shape === "arrow";

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = now - last;
      last = now;
      const next = (timeRef.current + dt) % 7200;
      timeRef.current = next;
      setPreviewTimeMs(next);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function updateKeymode(
    patch: Partial<{
      shape: NoteShape;
      columns: ColumnSkin[];
      uniformColors: boolean;
      uniformWidth: boolean;
      uniformSize: boolean;
      lnTailShape: LnTailShape;
      lnShowHead: boolean;
    }>,
  ) {
    const prev = getPreviewSkin();
    setPreviewSkin({
      ...prev,
      keymodes: {
        ...prev.keymodes,
        [keys]: {
          ...prev.keymodes[keys],
          ...patch,
          columns: patch.columns ?? prev.keymodes[keys].columns,
        },
      },
    });
  }

  function updateColumn(index: number, patch: Partial<ColumnSkin>) {
    updateKeymode({
      columns: keySkin.columns.map((c, i) => {
        if (i === index) return { ...c, ...patch };
        if (index !== 0) return c;
        return {
          ...c,
          ...(keySkin.uniformColors && patch.noteColor !== undefined
            ? { noteColor: patch.noteColor }
            : {}),
          ...(keySkin.uniformColors && patch.lnColor !== undefined
            ? { lnColor: patch.lnColor }
            : {}),
          ...(keySkin.uniformWidth && patch.widthScale !== undefined
            ? { widthScale: patch.widthScale }
            : {}),
          ...(keySkin.uniformSize && patch.heightScale !== undefined
            ? { heightScale: patch.heightScale }
            : {}),
          ...(keySkin.uniformSize && patch.lnBodyScale !== undefined
            ? { lnBodyScale: patch.lnBodyScale }
            : {}),
        };
      }),
    });
  }

  function setUniformColors(enabled: boolean) {
    if (!enabled) {
      updateKeymode({ uniformColors: false });
      return;
    }
    const first = keySkin.columns[0]!;
    updateKeymode({
      uniformColors: true,
      columns: keySkin.columns.map((c) => ({
        ...c,
        noteColor: first.noteColor,
        lnColor: first.lnColor,
      })),
    });
  }

  function setUniformWidth(enabled: boolean) {
    if (!enabled) {
      updateKeymode({ uniformWidth: false });
      return;
    }
    const first = keySkin.columns[0]!;
    updateKeymode({
      uniformWidth: true,
      columns: keySkin.columns.map((c) => ({
        ...c,
        widthScale: first.widthScale,
      })),
    });
  }

  function setUniformSize(enabled: boolean) {
    if (!enabled) {
      updateKeymode({ uniformSize: false });
      return;
    }
    const first = keySkin.columns[0]!;
    updateKeymode({
      uniformSize: true,
      columns: keySkin.columns.map((c) => ({
        ...c,
        heightScale: first.heightScale,
        lnBodyScale: first.lnBodyScale,
      })),
    });
  }

  function applyDancePadOrientations() {
    const layout: NoteOrientation[] = ["left", "down", "up", "right"];
    updateKeymode({
      columns: keySkin.columns.map((c, i) => ({
        ...c,
        orientation: layout[i % layout.length]!,
      })),
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle>Preview skin</PageTitle>
          <p className="rx-subtitle">
            Customize note shape, colors, size, hit position, and lane cover for
            each keymode. Applies to beatmap preview.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rx-btn"
            onClick={() => resetKeymodeSkin(keys)}
          >
            Reset {keys}K
          </button>
          <button
            type="button"
            className="rx-btn"
            onClick={() => resetPreviewSkin()}
          >
            Reset all
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {KEYMODES.map((k) => (
          <button
            key={k}
            type="button"
            className={keys === k ? "rx-btn-primary" : "rx-btn"}
            onClick={() => setKeys(k)}
          >
            {k}K
          </button>
        ))}
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="space-y-4">
          <div className="rx-panel p-4">
            <h2 className="text-sm font-bold text-ink">Note shape</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {NOTE_SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={
                    keySkin.shape === s.id ? "rx-btn-primary" : "rx-btn"
                  }
                  onClick={() => updateKeymode({ shape: s.id })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {isArrow ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted">
                  Set per-column arrow direction below. Receptors follow the
                  same orientation.
                </p>
                <button
                  type="button"
                  className="rx-btn text-xs"
                  onClick={applyDancePadOrientations}
                  title="← ↓ ↑ → repeating across columns"
                >
                  Dance pad layout
                </button>
              </div>
            ) : null}
          </div>

          <div className="rx-panel p-4">
            <h2 className="text-sm font-bold text-ink">Long notes</h2>
            <p className="mt-1 text-xs text-muted">
              Tail is the far end of the hold. Head is the note graphic at the
              start — same as the examples with a pointed grey bar and optional
              arrow on top.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <span className="text-xs text-muted">LN end shape</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {LN_TAIL_SHAPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={
                        keySkin.lnTailShape === s.id
                          ? "rx-btn-primary"
                          : "rx-btn"
                      }
                      onClick={() => updateKeymode({ lnTailShape: s.id })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={keySkin.lnShowHead}
                  onChange={(e) =>
                    updateKeymode({ lnShowHead: e.target.checked })
                  }
                  className="accent-[var(--accent)]"
                />
                Show note head at LN start
              </label>
            </div>
          </div>

          <div className="rx-panel p-4">
            <h2 className="text-sm font-bold text-ink">Playfield</h2>
            <p className="mt-1 text-xs text-muted">
              Hit position moves the receptor line. Lane cover blacks out the
              top so the visible field looks shorter.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                <span>Hit position {Math.round(skin.hitPosition * 100)}%</span>
                <input
                  type="range"
                  min={HIT_POSITION_MIN}
                  max={HIT_POSITION_MAX}
                  step={0.01}
                  value={skin.hitPosition}
                  onInput={(e) => {
                    const hitPosition = Number(e.currentTarget.value);
                    const prev = getPreviewSkin();
                    setPreviewSkin({ ...prev, hitPosition });
                  }}
                  className="accent-[var(--accent)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                <span>Lane cover {Math.round(skin.laneCover * 100)}%</span>
                <input
                  type="range"
                  min={LANE_COVER_MIN}
                  max={LANE_COVER_MAX}
                  step={0.01}
                  value={skin.laneCover}
                  onInput={(e) => {
                    const laneCover = Number(e.currentTarget.value);
                    const prev = getPreviewSkin();
                    setPreviewSkin({ ...prev, laneCover });
                  }}
                  className="accent-[var(--accent)]"
                />
              </label>
            </div>
          </div>

          <div className="rx-panel overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
              <h2 className="text-sm font-bold text-ink">Columns</h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={keySkin.uniformColors}
                    onChange={(e) => setUniformColors(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  Same color for all columns
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={keySkin.uniformWidth}
                    onChange={(e) => setUniformWidth(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  Same width for all columns
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={keySkin.uniformSize}
                    onChange={(e) => setUniformSize(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  Same size for all columns
                </label>
                <button
                  type="button"
                  className="rx-btn text-xs"
                  onClick={() =>
                    updateKeymode({
                      columns: defaultKeymodeSkin(keys).columns,
                    })
                  }
                >
                  Reset columns
                </button>
              </div>
            </div>
            <ul className="divide-y divide-white/5">
              {keySkin.columns.map((col, i) => {
                const showColors = !keySkin.uniformColors || i === 0;
                const showWidth = !keySkin.uniformWidth || i === 0;
                const showSize = !keySkin.uniformSize || i === 0;
                return (
                  <li key={i} className="space-y-3 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <span className="w-16 text-xs font-bold uppercase tracking-wider text-faint">
                        Col {i + 1}
                      </span>
                      <div
                        className="h-4 w-4 rounded-sm ring-1 ring-white/20"
                        style={{ background: col.noteColor }}
                        aria-hidden
                      />
                      <div
                        className="h-4 w-4 rounded-sm ring-1 ring-white/20"
                        style={{ background: col.lnColor }}
                        aria-hidden
                      />
                      {isArrow ? (
                        <span className="text-sm text-ink" aria-hidden>
                          {NOTE_ORIENTATIONS.find(
                            (o) => o.id === col.orientation,
                          )?.label ?? "↓"}
                        </span>
                      ) : null}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {showColors ? (
                        <>
                          <ColorField
                            label="Note"
                            value={col.noteColor}
                            onChange={(noteColor) =>
                              updateColumn(i, { noteColor })
                            }
                          />
                          <ColorField
                            label="LN body"
                            value={col.lnColor}
                            onChange={(lnColor) => updateColumn(i, { lnColor })}
                          />
                        </>
                      ) : null}
                      {isArrow ? (
                        <div className="flex flex-col gap-1.5 text-xs text-muted sm:col-span-2">
                          <span>Orientation</span>
                          <div className="flex flex-wrap gap-1.5">
                            {NOTE_ORIENTATIONS.map((o) => (
                              <button
                                key={o.id}
                                type="button"
                                className={
                                  col.orientation === o.id
                                    ? "rx-btn-primary min-w-10 px-2"
                                    : "rx-btn min-w-10 px-2"
                                }
                                title={o.id}
                                aria-label={`Orient ${o.id}`}
                                onClick={() =>
                                  updateColumn(i, { orientation: o.id })
                                }
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {showWidth ? (
                        <label className="flex flex-col gap-1 text-xs text-muted">
                          <span>Width {Math.round(col.widthScale * 100)}%</span>
                          <input
                            type="range"
                            min={0.4}
                            max={1}
                            step={0.01}
                            value={col.widthScale}
                            onInput={(e) => {
                              const widthScale = Number(e.currentTarget.value);
                              updateColumn(i, { widthScale });
                            }}
                            className="accent-[var(--accent)]"
                          />
                        </label>
                      ) : null}
                      {showSize ? (
                        <label className="flex flex-col gap-1 text-xs text-muted">
                          <span>
                            {keySkin.shape === "flat" ? "Height" : "Size"}{" "}
                            {Math.round(col.heightScale * 100)}%
                          </span>
                          <input
                            type="range"
                            min={0.5}
                            max={2}
                            step={0.05}
                            value={col.heightScale}
                            onInput={(e) => {
                              const heightScale = Number(e.currentTarget.value);
                              updateColumn(i, { heightScale });
                            }}
                            className="accent-[var(--accent)]"
                          />
                        </label>
                      ) : null}
                      {showSize ? (
                        <label className="flex flex-col gap-1 text-xs text-muted">
                          <span>
                            LN body width {Math.round(col.lnBodyScale * 100)}%
                          </span>
                          <input
                            type="range"
                            min={0.25}
                            max={1}
                            step={0.01}
                            value={col.lnBodyScale}
                            onInput={(e) => {
                              const lnBodyScale = Number(e.currentTarget.value);
                              updateColumn(i, { lnBodyScale });
                            }}
                            className="accent-[var(--accent)]"
                          />
                        </label>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rx-panel p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">Live preview</h2>
              <button
                type="button"
                className="rx-btn text-xs"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "Pause" : "Play"}
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={7200}
              step={16}
              value={Math.min(previewTimeMs, 7200)}
              onInput={(e) => {
                const next = Number(e.currentTarget.value);
                timeRef.current = next;
                setPreviewTimeMs(next);
              }}
              className="w-full accent-[var(--accent)]"
              aria-label="Preview time"
            />
            <div className="mt-3 h-[28rem] overflow-hidden rounded-xl bg-black/40">
              <ManiaNotefield
                columnCount={keys}
                notes={sampleNotes}
                skinOverride={keySkin}
                getCurrentTimeMs={() => timeRef.current}
              />
            </div>
          </div>
          <p className="text-xs text-faint">
            Changes save automatically in this browser and apply to preview
            modals immediately.
          </p>
        </div>
      </section>
    </div>
  );
}
