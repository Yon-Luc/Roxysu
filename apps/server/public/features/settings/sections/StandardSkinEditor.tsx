import { useEffect, useRef, useState } from "react";
import {
  StdPlayfield,
  type StdHitObject,
  type StdPlayfieldJudgment,
} from "../../../components/StdPlayfield";
import {
  comboColorFor,
  getStdSkin,
  resetStdSkin,
  setStdSkin,
  HIT_CIRCLE_SCALE_MAX,
  HIT_CIRCLE_SCALE_MIN,
  type StdSkin,
} from "../../../lib/stdSkin";
import { useAppDict } from "../../../lib/i18n";
import { SkinColorInput } from "../SkinColorInput";

const LOOP_MS = 9000;

function demoCircle(x: number, y: number, timeMs: number): StdHitObject {
  return { type: "circle", x, y, timeMs, stackX: x, stackY: y };
}

function demoSlider({
  x,
  y,
  x1,
  y1,
  timeMs,
  endMs,
  repeats,
}: {
  x: number;
  y: number;
  x1: number;
  y1: number;
  timeMs: number;
  endMs: number;
  repeats: number;
}): StdHitObject {
  const steps = 12;
  const path = Array.from({ length: steps + 1 }, (_, i) => {
    const u = i / steps;
    return { x: x + (x1 - x) * u, y: y + (y1 - y) * u };
  });
  const spanMs = (endMs - timeMs) / Math.max(1, repeats);
  const tickCount = 3;
  const ticks: { frac: number; tMs: number }[] = [];
  for (let span = 0; span < repeats; span += 1) {
    for (let i = 1; i <= tickCount; i += 1) {
      const local = i / (tickCount + 1);
      const frac = span % 2 === 1 ? 1 - local : local;
      ticks.push({ frac, tMs: timeMs + span * spanMs + local * spanMs });
    }
  }
  return {
    type: "slider",
    x,
    y,
    timeMs,
    endMs,
    repeats,
    pixelLength: Math.hypot(x1 - x, y1 - y),
    stackX: x,
    stackY: y,
    path,
    ticks,
  };
}

/** Dense looping chart so combo colors, ticks, and slider bodies stay on screen. */
const DEMO_OBJECTS: StdHitObject[] = [
  demoCircle(96, 128, 700),
  demoCircle(192, 220, 980),
  demoCircle(288, 128, 1260),
  demoCircle(384, 220, 1540),
  demoCircle(416, 300, 1820),
  demoSlider({
    x: 80,
    y: 80,
    x1: 430,
    y1: 80,
    timeMs: 2100,
    endMs: 3700,
    repeats: 1,
  }),
  demoCircle(128, 300, 2500),
  demoCircle(256, 320, 2820),
  demoCircle(384, 300, 3140),
  demoSlider({
    x: 430,
    y: 160,
    x1: 90,
    y1: 280,
    timeMs: 3800,
    endMs: 5600,
    repeats: 2,
  }),
  demoCircle(160, 96, 4300),
  demoCircle(256, 192, 4620),
  demoCircle(352, 96, 4940),
  demoCircle(256, 300, 5800),
  demoCircle(128, 192, 6120),
  demoCircle(384, 192, 6440),
  { type: "spinner", timeMs: 7000, endMs: 8400 },
];

/** Synthesized "great" hits so ticks, follow circle, and popups render. */
const DEMO_JUDGMENTS: StdPlayfieldJudgment[] = DEMO_OBJECTS.flatMap((obj, noteIndex) => {
  if (obj.type === "circle" || obj.type === "spinner") {
    return [{ noteIndex, tMs: obj.timeMs, result: "great" as const }];
  }
  return [
    { noteIndex, tMs: obj.timeMs, result: "great" as const, kind: "head" as const },
    ...obj.ticks.map((tick) => ({
      noteIndex,
      tMs: tick.tMs,
      result: "great" as const,
      kind: "tick" as const,
      frac: tick.frac,
    })),
    { noteIndex, tMs: obj.endMs, result: "great" as const, kind: "tail" as const },
  ];
});

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

function Toggle({ label, checked, onChange }: {
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

export function StandardSkinEditor() {
  const { dict } = useAppDict();
  const [skin, setSkin] = useState(() => getStdSkin());
  const [playing, setPlaying] = useState(true);
  const timeRef = useRef(0);

  function update(patch: Partial<StdSkin>) {
    const next = { ...skin, ...patch };
    setSkin(next);
    setStdSkin(next);
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
    <div
      id="section-std-skin"
      className="rx-panel scroll-mt-6 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">
          {dict?.skin.stdTitle ?? "osu!standard skin"}
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
              resetStdSkin();
              setSkin(getStdSkin());
            }}
          >
            {dict?.skin.resetStd ?? "Reset standard skin"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {dict?.skin.stdDesc ??
          "Standard playfield visuals: combo colors, slider ticks, follow circle, and hit popups."}
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
        <div className="h-[24rem] overflow-hidden rounded-xl bg-black/40">
          <StdPlayfield
            hitObjects={DEMO_OBJECTS}
            circleSize={4}
            approachRate={6}
            getCurrentTimeMs={() => timeRef.current}
            judgments={DEMO_JUDGMENTS}
            skin={skin}
          />
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5 text-xs text-muted">
            <span>
              {dict?.skin.stdHitCircleScale ?? "Hit circle / slider size"}{" "}
              {Math.round(skin.hitCircleScale * 100)}%
            </span>
            <input
              type="range"
              min={HIT_CIRCLE_SCALE_MIN}
              max={HIT_CIRCLE_SCALE_MAX}
              step={0.05}
              value={skin.hitCircleScale}
              onInput={(e) =>
                update({ hitCircleScale: Number(e.currentTarget.value) })
              }
              className="w-full accent-[var(--accent)]"
              aria-label={dict?.skin.stdHitCircleScale ?? "Hit circle / slider size"}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-ink">
              {dict?.skin.stdComboColors ?? "Combo colors"}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {skin.comboColors.map((color, index) => (
                <SkinColorInput
                  key={index}
                  value={color}
                  onChange={(next) =>
                    update({
                      comboColors: skin.comboColors.map((c, i) =>
                        i === index ? next : c,
                      ),
                    })
                  }
                  className="size-9 cursor-pointer rounded border border-black/40"
                  aria-label={`${dict?.skin.noteColor ?? "Note"} ${index + 1}`}
                  title={`${dict?.skin.noteColor ?? "Note"} ${index + 1} — ${comboColorFor(skin, index + 1)}`}
                />
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <ColorRow
              label={dict?.skin.stdSliderTrack ?? "Slider track"}
              value={skin.sliderTrack}
              onChange={(v) => update({ sliderTrack: v })}
            />
            <ColorRow
              label={dict?.skin.stdSliderFill ?? "Slider fill"}
              value={skin.sliderFill}
              onChange={(v) => update({ sliderFill: v })}
            />
            <ColorRow
              label={dict?.skin.stdSliderBall ?? "Slider ball"}
              value={skin.sliderBall}
              onChange={(v) => update({ sliderBall: v })}
            />
            <ColorRow
              label={dict?.skin.stdSpinner ?? "Spinner"}
              value={skin.spinner}
              onChange={(v) => update({ spinner: v })}
            />
            <ColorRow
              label={dict?.skin.stdApproach ?? "Approach"}
              value={skin.approach}
              onChange={(v) => update({ approach: v })}
            />
            <ColorRow
              label={dict?.skin.stdCursor ?? "Cursor"}
              value={skin.cursor}
              onChange={(v) => update({ cursor: v })}
            />
            <ColorRow
              label={dict?.skin.stdTrail ?? "Cursor trail"}
              value={skin.trail}
              onChange={(v) => update({ trail: v })}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-ink">
              {dict?.skin.stdElements ?? "Elements"}
            </legend>
            <Toggle
              label={dict?.skin.stdComboNumbers ?? "Combo numbers"}
              checked={skin.showComboNumbers}
              onChange={(v) => update({ showComboNumbers: v })}
            />
            <Toggle
              label={dict?.skin.stdSliderTicks ?? "Slider ticks"}
              checked={skin.showSliderTicks}
              onChange={(v) => update({ showSliderTicks: v })}
            />
            <Toggle
              label={dict?.skin.stdFollowCircle ?? "Follow circle"}
              checked={skin.showFollowCircle}
              onChange={(v) => update({ showFollowCircle: v })}
            />
            <Toggle
              label={dict?.skin.stdHitPopups ?? "Hit popups"}
              checked={skin.showHitPopups}
              onChange={(v) => update({ showHitPopups: v })}
            />
          </fieldset>
        </div>
      </div>
    </div>
  );
}