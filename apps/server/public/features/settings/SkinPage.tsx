import { useEffect, useMemo, useRef, useState } from "react";
import { PageTitle } from "../../components/PageTitle";
import { ManiaNotefield } from "../../components/ManiaNotefield";
import { StandardSkinEditor } from "./sections/StandardSkinEditor";
import {
  KEYMODES,
  LN_TAIL_SHAPES,
  NOTE_ORIENTATIONS,
  NOTE_SHAPES,
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
  copyKeymodeColors,
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
import {
  pageSectionDomId,
  useScrollToPageSection,
} from "../../lib/pageSections";
import { useAppDict, t } from "../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";

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
  const { dict } = useAppDict();
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
          aria-label={t(dict?.skin.colorPickerAria, { label })}
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
          aria-label={t(dict?.skin.hexValueAria, { label })}
        />
        <button
          type="button"
          className="rx-btn h-8 shrink-0 px-2 text-xs"
          title={t(dict?.skin.copyTitle, { hex })}
          onClick={() => void copyHex()}
        >
          {copied ? dict?.skin.copied : dict?.skin.copy}
        </button>
      </div>
    </div>
  );
}

export function SkinPage({ section }: { section?: string } = {}) {
  useScrollToPageSection(section);
  const skin = usePreviewSkin();
  const { dict } = useAppDict();
  const [keys, setKeys] = useState<Keymode>(7);
  const [previewTimeMs, setPreviewTimeMs] = useState(800);
  const [playing, setPlaying] = useState(true);
  const [tab, setTab] = useState<"mania" | "std">(
    section === "std-skin" ? "std" : "mania",
  );
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
          <PageTitle>{dict?.skin.pageTitle}</PageTitle>
          <p className="rx-subtitle">{dict?.skin.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rx-btn"
            onClick={() => resetKeymodeSkin(keys)}
          >
            {t(dict?.skin.resetKeymode, { keys })}
          </button>
          <button
            type="button"
            className="rx-btn"
            onClick={() => resetPreviewSkin()}
          >
            {dict?.skin.resetAll}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Ruleset">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mania"}
          className={tab === "mania" ? "rx-btn-primary" : "rx-btn"}
          onClick={() => setTab("mania")}
        >
          {dict?.skin.tabMania ?? "Mania"}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "std"}
          className={tab === "std" ? "rx-btn-primary" : "rx-btn"}
          onClick={() => setTab("std")}
        >
          {dict?.skin.tabStandard ?? "osu!standard"}
        </button>
      </div>

      {tab === "mania" ? (
        <>
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
          <div
            id={pageSectionDomId("note-shape")}
            className="rx-panel scroll-mt-6 p-4"
          >
            <h2 className="text-sm font-bold text-ink">
              {dict?.skin.noteShape}
            </h2>
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
                  {dict?.skin.shapes[s.id] ?? s.label}
                </button>
              ))}
            </div>
            {isArrow ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted">
                  {dict?.skin.noteShapeDesc}
                </p>
                <button
                  type="button"
                  className="rx-btn text-xs"
                  onClick={applyDancePadOrientations}
                  title={dict?.skin.dancePadTitle}
                >
                  {dict?.skin.dancePad}
                </button>
              </div>
            ) : null}
          </div>

          <div
            id={pageSectionDomId("long-notes")}
            className="rx-panel scroll-mt-6 p-4"
          >
            <h2 className="text-sm font-bold text-ink">
              {dict?.skin.longNotes}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {dict?.skin.longNotesDesc}
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <span className="text-xs text-muted">
                  {dict?.skin.lnEndShape}
                </span>
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
                      {dict?.skin.lnTailShapes[s.id] ?? s.label}
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
                {dict?.skin.showNoteHead}
              </label>
            </div>
          </div>

          <div
            id={pageSectionDomId("playfield")}
            className="rx-panel scroll-mt-6 p-4"
          >
            <h2 className="text-sm font-bold text-ink">
              {dict?.skin.playfield}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {dict?.skin.playfieldDesc}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                <span>
                  {t(dict?.skin.hitPosition, {
                    pct: Math.round(skin.hitPosition * 100),
                  })}
                </span>
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
                <span>
                  {t(dict?.skin.laneCover, {
                    pct: Math.round(skin.laneCover * 100),
                  })}
                </span>
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

          <div
            id={pageSectionDomId("columns")}
            className="rx-panel scroll-mt-6 overflow-hidden p-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
              <h2 className="text-sm font-bold text-ink">
                {dict?.skin.columns}
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={keySkin.uniformColors}
                    onChange={(e) => setUniformColors(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  {dict?.skin.sameColor}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={keySkin.uniformWidth}
                    onChange={(e) => setUniformWidth(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  {dict?.skin.sameWidth}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={keySkin.uniformSize}
                    onChange={(e) => setUniformSize(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  {dict?.skin.sameSize}
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <span className="whitespace-nowrap">
                    {dict?.skin.copyColorsFrom}
                  </span>
                  <select
                    className="rx-select py-1.5 text-xs"
                    value=""
                    title={dict?.skin.copyColorsFromTitle}
                    aria-label={dict?.skin.copyColorsFromTitle}
                    onChange={(e) => {
                      const from = Number(e.target.value) as Keymode;
                      if (!KEYMODES.includes(from)) return;
                      copyKeymodeColors(from, keys);
                    }}
                  >
                    <option value="" disabled>
                      {dict?.skin.copyColorsFromPlaceholder}
                    </option>
                    {KEYMODES.filter((k) => k !== keys).map((k) => (
                      <option key={k} value={k}>
                        {t(dict?.skin.copyColorsFromOption, { keys: k })}
                      </option>
                    ))}
                  </select>
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
                  {dict?.skin.resetColumns}
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
                        {t(dict?.skin.colPrefix, { n: i + 1 })}
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
                            label={dict?.skin.noteColor ?? "Note"}
                            value={col.noteColor}
                            onChange={(noteColor) =>
                              updateColumn(i, { noteColor })
                            }
                          />
                          <ColorField
                            label={dict?.skin.lnBody ?? "LN body"}
                            value={col.lnColor}
                            onChange={(lnColor) => updateColumn(i, { lnColor })}
                          />
                        </>
                      ) : null}
                      {isArrow ? (
                        <div className="flex flex-col gap-1.5 text-xs text-muted sm:col-span-2">
                          <span>{dict?.skin.orientation}</span>
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
                                aria-label={t(dict?.skin.orientAria, {
                                  id: o.id,
                                })}
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
                          <span>
                            {t(dict?.skin.width, {
                              pct: Math.round(col.widthScale * 100),
                            })}
                          </span>
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
                            {t(
                              keySkin.shape === "flat"
                                ? dict?.skin.height
                                : dict?.skin.size,
                              { pct: Math.round(col.heightScale * 100) },
                            )}
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
                            {t(dict?.skin.lnBodyWidth, {
                              pct: Math.round(col.lnBodyScale * 100),
                            })}
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
          <div
            id={pageSectionDomId("live-preview")}
            className="rx-panel scroll-mt-6 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">
                {dict?.skin.livePreview}
              </h2>
              <button
                type="button"
                className="rx-btn text-xs"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? dict?.skin.pause : dict?.skin.play}
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
              aria-label={dict?.skin.previewTime}
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
          <p className="text-xs text-faint">{dict?.skin.saveNote}</p>
        </div>
      </section>
        </>
      ) : null}

      {tab === "std" ? <StandardSkinEditor /> : null}
    </div>
  );
}
