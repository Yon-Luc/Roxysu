import { useEffect, useRef, useState } from "react";
import {
  TaikoPlayfield,
  type TaikoHitObject,
  type TaikoPlayfieldJudgment,
} from "../../../components/TaikoPlayfield";
import {
  getTaikoSkin,
  resetTaikoSkin,
  setTaikoSkin,
  TAIKO_NOTE_SCALE_MAX,
  TAIKO_NOTE_SCALE_MIN,
  TAIKO_SCROLL_MAX,
  TAIKO_SCROLL_MIN,
  type TaikoSkin,
} from "../../../lib/taikoSkin";
import { useAppDict } from "../../../lib/i18n";
import { SkinColorInput } from "../SkinColorInput";

const LOOP_MS = 8000;

const DEMO_OBJECTS: TaikoHitObject[] = [
  { type: "hit", timeMs: 600, color: "don", large: false },
  { type: "hit", timeMs: 900, color: "kat", large: false },
  { type: "hit", timeMs: 1200, color: "don", large: true },
  { type: "hit", timeMs: 1500, color: "kat", large: true },
  { type: "hit", timeMs: 1800, color: "don", large: false },
  { type: "hit", timeMs: 2000, color: "kat", large: false },
  {
    type: "drumroll",
    timeMs: 2400,
    endMs: 3800,
    large: false,
    ticks: [2600, 2800, 3000, 3200, 3400, 3600].map((tMs) => ({ tMs })),
  },
  { type: "hit", timeMs: 4100, color: "don", large: false },
  { type: "hit", timeMs: 4300, color: "kat", large: false },
  { type: "swell", timeMs: 4800, endMs: 6200 },
  { type: "hit", timeMs: 6600, color: "don", large: true },
  { type: "hit", timeMs: 7000, color: "kat", large: false },
];

const DEMO_JUDGMENTS: TaikoPlayfieldJudgment[] = DEMO_OBJECTS.flatMap(
  (obj, noteIndex): TaikoPlayfieldJudgment[] => {
    if (obj.type === "hit") {
      return [{ noteIndex, tMs: obj.timeMs, result: "great", kind: "hit" }];
    }
    if (obj.type === "drumroll") {
      return obj.ticks.map((tick) => ({
        noteIndex,
        tMs: tick.tMs,
        result: "great" as const,
        kind: "roll" as const,
      }));
    }
    return [
      { noteIndex, tMs: obj.endMs, result: "great", kind: "swell" },
    ];
  },
);

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => setDraft(value.toUpperCase()), [value]);
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <SkinColorInput
          value={value}
          onChange={onChange}
          className="h-8 w-10 shrink-0 cursor-pointer rounded bg-transparent"
          aria-label={label}
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
          onBlur={() => setDraft(value.toUpperCase())}
          className="rx-input h-8 min-w-0 flex-1 font-mono text-xs uppercase"
          aria-label={label}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

export function TaikoSkinEditor() {
  const { dict } = useAppDict();
  const [skin, setSkin] = useState(() => getTaikoSkin());
  const [playing, setPlaying] = useState(true);
  const timeRef = useRef(0);

  function update(patch: Partial<TaikoSkin>) {
    const next = { ...skin, ...patch };
    setSkin(next);
    setTaikoSkin(next);
  }

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = now - last;
      last = now;
      timeRef.current = (timeRef.current + dt) % LOOP_MS;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div id="section-taiko-skin" className="rx-panel scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">
          {dict?.skin.taikoTitle ?? "Taiko skin"}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rx-btn text-xs"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? dict?.skin.pause : dict?.skin.play}
          </button>
          <button
            type="button"
            className="rx-btn text-xs"
            onClick={() => {
              resetTaikoSkin();
              setSkin(getTaikoSkin());
            }}
          >
            {dict?.skin.resetTaiko ?? "Reset taiko skin"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {dict?.skin.taikoDesc ??
          "Taiko playfield visuals: don/kat colors, scroll speed, and hit popups."}
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <div className="h-[16rem] overflow-hidden rounded-xl bg-black/40">
          <TaikoPlayfield
            hitObjects={DEMO_OBJECTS}
            getCurrentTimeMs={() => timeRef.current}
            judgments={DEMO_JUDGMENTS}
            skin={skin}
          />
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5 text-xs text-muted">
            <span>
              {dict?.skin.taikoScroll ?? "Scroll speed"} {Math.round(skin.scrollSpeed)}
            </span>
            <input
              type="range"
              min={TAIKO_SCROLL_MIN}
              max={TAIKO_SCROLL_MAX}
              step={20}
              value={skin.scrollSpeed}
              onInput={(e) =>
                update({ scrollSpeed: Number(e.currentTarget.value) })
              }
              className="w-full accent-[var(--accent)]"
            />
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-muted">
            <span>
              {dict?.skin.taikoNoteScale ?? "Note size"}{" "}
              {Math.round(skin.noteScale * 100)}%
            </span>
            <input
              type="range"
              min={TAIKO_NOTE_SCALE_MIN}
              max={TAIKO_NOTE_SCALE_MAX}
              step={0.05}
              value={skin.noteScale}
              onInput={(e) =>
                update({ noteScale: Number(e.currentTarget.value) })
              }
              className="w-full accent-[var(--accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ColorRow
              label={dict?.skin.taikoDon ?? "Don"}
              value={skin.don}
              onChange={(v) => update({ don: v })}
            />
            <ColorRow
              label={dict?.skin.taikoKat ?? "Kat"}
              value={skin.kat}
              onChange={(v) => update({ kat: v })}
            />
            <ColorRow
              label={dict?.skin.taikoDonLarge ?? "Large don"}
              value={skin.donLarge}
              onChange={(v) => update({ donLarge: v })}
            />
            <ColorRow
              label={dict?.skin.taikoKatLarge ?? "Large kat"}
              value={skin.katLarge}
              onChange={(v) => update({ katLarge: v })}
            />
            <ColorRow
              label={dict?.skin.taikoDrumroll ?? "Drumroll"}
              value={skin.drumroll}
              onChange={(v) => update({ drumroll: v })}
            />
            <ColorRow
              label={dict?.skin.taikoSwell ?? "Swell"}
              value={skin.swell}
              onChange={(v) => update({ swell: v })}
            />
            <ColorRow
              label={dict?.skin.taikoReceptor ?? "Receptor"}
              value={skin.receptor}
              onChange={(v) => update({ receptor: v })}
            />
            <ColorRow
              label={dict?.skin.taikoPlayfield ?? "Playfield"}
              value={skin.playfield}
              onChange={(v) => update({ playfield: v })}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-ink">
              {dict?.skin.stdElements ?? "Elements"}
            </legend>
            <Toggle
              label={dict?.skin.stdHitPopups ?? "Hit popups"}
              checked={skin.showHitPopups}
              onChange={(v) => update({ showHitPopups: v })}
            />
            <Toggle
              label={dict?.skin.taikoBarlines ?? "Barlines"}
              checked={skin.showBarlines}
              onChange={(v) => update({ showBarlines: v })}
            />
          </fieldset>
        </div>
      </div>
    </div>
  );
}
