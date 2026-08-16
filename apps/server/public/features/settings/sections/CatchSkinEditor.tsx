import { useEffect, useRef, useState } from "react";
import {
  CatchPlayfield,
  type CatchHitObject,
  type CatchPlayfieldJudgment,
} from "../../../components/CatchPlayfield";
import {
  CATCHER_SCALE_MAX,
  CATCHER_SCALE_MIN,
  catchComboColorFor,
  getCatchSkin,
  resetCatchSkin,
  setCatchSkin,
  type CatchSkin,
} from "../../../lib/catchSkin";
import { useAppDict } from "../../../lib/i18n";

const LOOP_MS = 8000;

const DEMO_OBJECTS: CatchHitObject[] = [
  { type: "fruit", x: 80, timeMs: 700, hyperDash: false },
  { type: "fruit", x: 180, timeMs: 1000, hyperDash: false },
  { type: "fruit", x: 280, timeMs: 1300, hyperDash: false },
  { type: "fruit", x: 420, timeMs: 1600, hyperDash: true },
  { type: "droplet", x: 200, timeMs: 2000, kind: "tiny" },
  { type: "droplet", x: 240, timeMs: 2140, kind: "large" },
  { type: "droplet", x: 280, timeMs: 2280, kind: "tiny" },
  { type: "fruit", x: 320, timeMs: 2500, hyperDash: false },
  { type: "fruit", x: 160, timeMs: 2900, hyperDash: false },
  { type: "banana", x: 100, timeMs: 3400 },
  { type: "banana", x: 250, timeMs: 3520 },
  { type: "banana", x: 400, timeMs: 3640 },
  { type: "fruit", x: 256, timeMs: 4200, hyperDash: false },
  { type: "fruit", x: 90, timeMs: 4600, hyperDash: true },
  { type: "fruit", x: 400, timeMs: 5100, hyperDash: false },
  { type: "fruit", x: 220, timeMs: 5600, hyperDash: false },
  { type: "fruit", x: 340, timeMs: 6100, hyperDash: false },
  { type: "fruit", x: 150, timeMs: 6600, hyperDash: false },
];

const DEMO_FRAMES = Array.from({ length: 80 }, (_, i) => {
  const tMs = i * 100;
  const x = 256 + Math.sin(i / 6) * 140;
  return { tMs, x, dashing: i % 18 > 14 };
});

const DEMO_JUDGMENTS: CatchPlayfieldJudgment[] = DEMO_OBJECTS.map(
  (obj, noteIndex) => ({
    noteIndex,
    tMs: obj.timeMs,
    result: obj.type === "banana" ? ("meh" as const) : ("great" as const),
    kind: obj.type,
  }),
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
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
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

export function CatchSkinEditor() {
  const { dict } = useAppDict();
  const [skin, setSkin] = useState(() => getCatchSkin());
  const [playing, setPlaying] = useState(true);
  const timeRef = useRef(0);

  function update(patch: Partial<CatchSkin>) {
    const next = { ...skin, ...patch };
    setSkin(next);
    setCatchSkin(next);
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
    <div id="section-catch-skin" className="rx-panel scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">
          {dict?.skin.catchTitle ?? "Catch skin"}
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
              resetCatchSkin();
              setSkin(getCatchSkin());
            }}
          >
            {dict?.skin.resetCatch ?? "Reset catch skin"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {dict?.skin.catchDesc ??
          "Catch playfield visuals: fruit combo colors, catcher, droplets, and bananas."}
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <div className="h-[24rem] overflow-hidden rounded-xl bg-black/40">
          <CatchPlayfield
            hitObjects={DEMO_OBJECTS}
            circleSize={4}
            approachRate={6}
            getCurrentTimeMs={() => timeRef.current}
            frames={DEMO_FRAMES}
            judgments={DEMO_JUDGMENTS}
            skin={skin}
          />
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5 text-xs text-muted">
            <span>
              {dict?.skin.catcherScale ?? "Catcher size"}{" "}
              {Math.round(skin.catcherScale * 100)}%
            </span>
            <input
              type="range"
              min={CATCHER_SCALE_MIN}
              max={CATCHER_SCALE_MAX}
              step={0.05}
              value={skin.catcherScale}
              onInput={(e) =>
                update({ catcherScale: Number(e.currentTarget.value) })
              }
              className="w-full accent-[var(--accent)]"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-ink">
              {dict?.skin.stdComboColors ?? "Combo colors"}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {skin.comboColors.map((color, index) => (
                <input
                  key={`${index}-${color}`}
                  type="color"
                  value={color}
                  onChange={(e) =>
                    update({
                      comboColors: skin.comboColors.map((c, i) =>
                        i === index ? e.target.value : c,
                      ),
                    })
                  }
                  className="size-9 cursor-pointer rounded border border-black/40"
                  aria-label={`${dict?.skin.noteColor ?? "Note"} ${index + 1}`}
                  title={catchComboColorFor(skin, index + 1)}
                />
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <ColorRow
              label={dict?.skin.catchDroplet ?? "Droplet"}
              value={skin.droplet}
              onChange={(v) => update({ droplet: v })}
            />
            <ColorRow
              label={dict?.skin.catchBanana ?? "Banana"}
              value={skin.banana}
              onChange={(v) => update({ banana: v })}
            />
            <ColorRow
              label={dict?.skin.catchCatcher ?? "Catcher"}
              value={skin.catcher}
              onChange={(v) => update({ catcher: v })}
            />
            <ColorRow
              label={dict?.skin.catchHyperDash ?? "Hyperdash"}
              value={skin.hyperDash}
              onChange={(v) => update({ hyperDash: v })}
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
              label={dict?.skin.catchTrail ?? "Catcher trail"}
              checked={skin.showTrail}
              onChange={(v) => update({ showTrail: v })}
            />
          </fieldset>
        </div>
      </div>
    </div>
  );
}
