import { useEffect, useMemo, useRef, useState } from "react";
import { PageTitle } from "../../components/PageTitle";
import { ManiaNotefield } from "../../components/ManiaNotefield";
import {
  KEYMODES,
  NOTE_SHAPES,
  defaultKeymodeSkin,
  getPreviewSkin,
  resetKeymodeSkin,
  resetPreviewSkin,
  setPreviewSkin,
  usePreviewSkin,
  type ColumnSkin,
  type Keymode,
  type NoteShape,
} from "../../lib/previewSkin";

function buildSampleNotes(keys: number) {
  const notes: { column: number; startMs: number; endMs: number }[] = [];
  const pattern = [0, 1, 2, keys - 1, Math.floor(keys / 2), 0, keys - 2, 1];
  let t = 400;
  for (let i = 0; i < 48; i += 1) {
    const col = pattern[i % pattern.length]! % keys;
    const isHold = i % 5 === 0;
    notes.push({
      column: col,
      startMs: t,
      endMs: isHold ? t + 420 : t,
    });
    if (i % 3 === 2) {
      notes.push({
        column: (col + 2) % keys,
        startMs: t,
        endMs: t,
      });
    }
    t += 140;
  }
  return notes;
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
    patch: Partial<{ shape: NoteShape; columns: ColumnSkin[] }>,
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
    const columns = keySkin.columns.map((c, i) =>
      i === index ? { ...c, ...patch } : c,
    );
    updateKeymode({ columns });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle>Preview skin</PageTitle>
          <p className="rx-subtitle">
            Customize note shape, colors, and size per column for each keymode.
            Applies to beatmap preview.
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
          </div>

          <div className="rx-panel overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
              <h2 className="text-sm font-bold text-ink">Columns</h2>
              <button
                type="button"
                className="rx-btn text-xs"
                onClick={() =>
                  updateKeymode({ columns: defaultKeymodeSkin(keys).columns })
                }
              >
                Reset colors
              </button>
            </div>
            <ul className="divide-y divide-white/5">
              {keySkin.columns.map((col, i) => (
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
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <span className="w-16 shrink-0">Note</span>
                      <input
                        type="color"
                        value={col.noteColor}
                        onChange={(e) =>
                          updateColumn(i, { noteColor: e.target.value })
                        }
                        className="h-8 w-full cursor-pointer rounded bg-transparent"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <span className="w-16 shrink-0">LN body</span>
                      <input
                        type="color"
                        value={col.lnColor}
                        onChange={(e) =>
                          updateColumn(i, { lnColor: e.target.value })
                        }
                        className="h-8 w-full cursor-pointer rounded bg-transparent"
                      />
                    </label>
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
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      <span>Height {Math.round(col.heightScale * 100)}%</span>
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
                  </div>
                </li>
              ))}
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
