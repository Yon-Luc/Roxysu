import { useEffect, useMemo, useRef, useState } from "react";
import { render } from "@gpuix/react";
import { gpuixRenderOptions } from "./components/ui";

// ─── Palette ────────────────────────────────────────────────────────────────

const BG = "#0c0e12";
const PANEL = "#151922";
const PANEL_HOVER = "#1d2330";
const PLAYFIELD = "#080a0e";
const ACCENT = "#7dd3fc";
const TEXT = "#e8eef7";
const MUTED = "#8b95a8";
const BORDER = "#252b36";

const LANE_COLORS = [
  "#7dd3fc",
  "#93c5fd",
  "#6ee7b7",
  "#67e8f9",
  "#a78bfa",
  "#f9a8d4",
  "#fcd34d",
];

// ─── Layout ─────────────────────────────────────────────────────────────────

const LANES = 7;

const PLAYFIELD_WIDTH = 700;
const PLAYFIELD_HEIGHT = 680;

const NOTE_HEIGHT = 18;
const RECEPTOR_HEIGHT = 22;
const RECEPTOR_Y = PLAYFIELD_HEIGHT - 55;

// ─── Presets ────────────────────────────────────────────────────────────────

const PRESETS = {
  Normal: {
    speed: 700,
    notes: 150,
    spacing: 75,
  },

  Dense: {
    speed: 1200,
    notes: 500,
    spacing: 48,
  },

  Extreme: {
    speed: 2200,
    notes: 1500,
    spacing: 32,
  },

  Meltdown: {
    speed: 4500,
    notes: 4000,
    spacing: 20,
  },
} as const;

type PresetName = keyof typeof PRESETS;

const FPS_OPTIONS = [60, 120, 144, 165, 240, 360, 500, 1000];

// ─── Benchmark chart ────────────────────────────────────────────────────────
//
// Instead of:
//
//   Note[]
//   { id, lane, y, w, h, alpha }
//
// we keep every property in a typed array.
//
// This avoids creating thousands of JS objects every update.
//

type Chart = {
  count: number;

  lane: Uint8Array;
  y: Float64Array;
  width: Float32Array;
  height: Float32Array;
  alpha: Float32Array;
};

function createChart(count: number, spacing: number, torture: boolean): Chart {
  const lane = new Uint8Array(count);
  const y = new Float64Array(count);
  const width = new Float32Array(count);
  const height = new Float32Array(count);
  const alpha = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const pattern = i % 13;

    let selectedLane: number;

    if (pattern === 5 || pattern === 9) {
      selectedLane = Math.floor(Math.random() * LANES);
    } else if (pattern === 12) {
      selectedLane = [0, 2, 4, 6][i % 4];
    } else {
      selectedLane = Math.floor(Math.random() * LANES);
    }

    lane[i] = selectedLane;
    y[i] = -i * spacing;

    width[i] = torture ? 86 + Math.floor(Math.random() * 10) : 86;

    height[i] = torture
      ? NOTE_HEIGHT + Math.floor(Math.random() * 6)
      : NOTE_HEIGHT;

    alpha[i] = torture ? 0.75 + Math.random() * 0.25 : 1;
  }

  return {
    count,
    lane,
    y,
    width,
    height,
    alpha,
  };
}

// ─── Frame statistics ───────────────────────────────────────────────────────

const TIMING_WINDOW = 120;

function useFrameStats() {
  const buffer = useRef(new Float64Array(TIMING_WINDOW));

  const head = useRef(0);
  const count = useRef(0);

  const push = (dt: number) => {
    buffer.current[head.current] = dt;

    head.current = (head.current + 1) % TIMING_WINDOW;

    if (count.current < TIMING_WINDOW) {
      count.current++;
    }
  };

  const stats = () => {
    const n = count.current;

    if (n === 0) {
      return {
        avg: 0,
        min: 0,
        max: 0,
        jitter: 0,
        fps: 0,
      };
    }

    let sum = 0;
    let min = Infinity;
    let max = 0;

    for (let i = 0; i < n; i++) {
      const value = buffer.current[i];

      sum += value;

      if (value < min) {
        min = value;
      }

      if (value > max) {
        max = value;
      }
    }

    const avg = sum / n;

    return {
      avg,
      min,
      max,
      jitter: max - min,
      fps: Math.round(1000 / avg),
    };
  };

  return {
    push,
    stats,
  };
}

// ─── Controls ───────────────────────────────────────────────────────────────

function ControlButton({
  children,
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 7,
        borderRadius: 6,
        backgroundColor: active ? ACCENT : PANEL_HOVER,
        cursor: "pointer",
      }}
    >
      <text
        style={{
          color: active ? BG : TEXT,
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        {children}
      </text>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <text
        style={{
          color: MUTED,
          fontSize: 9,
          fontWeight: 600,
        }}
      >
        {label}
      </text>

      <text
        style={{
          color: warn ? "#f87171" : TEXT,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {value}
      </text>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({
  preset,
  setPreset,
  paused,
  setPaused,
  targetFps,
  setTargetFps,
  torture,
  setTorture,
  glow,
  setGlow,
}: {
  preset: PresetName;
  setPreset: (value: PresetName) => void;
  paused: boolean;
  setPaused: (value: boolean) => void;
  targetFps: number;
  setTargetFps: (value: number) => void;
  torture: boolean;
  setTorture: (value: boolean) => void;
  glow: boolean;
  setGlow: (value: boolean) => void;
}) {
  const config = PRESETS[preset];

  return (
    <div
      style={{
        width: PLAYFIELD_WIDTH,
        padding: 16,
        borderRadius: 12,
        backgroundColor: PANEL,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <text
            style={{
              color: ACCENT,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            ROXYSU / GPUIX BENCHMARK
          </text>

          <text
            style={{
              color: TEXT,
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            VSRG Renderer Test
          </text>
        </div>

        <div
          style={{
            display: "flex",
            gap: 7,
          }}
        >
          <ControlButton active={torture} onClick={() => setTorture(!torture)}>
            TORTURE
          </ControlButton>

          <ControlButton active={glow} onClick={() => setGlow(!glow)}>
            GLOW
          </ControlButton>

          <ControlButton active={paused} onClick={() => setPaused(!paused)}>
            {paused ? "RESUME" : "PAUSE"}
          </ControlButton>
        </div>
      </div>

      <div
        style={{
          height: 1,
          backgroundColor: BORDER,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <text
          style={{
            color: MUTED,
            fontSize: 9,
            fontWeight: 600,
          }}
        >
          CHART
        </text>

        {(Object.keys(PRESETS) as PresetName[]).map((name) => (
          <ControlButton
            key={name}
            active={preset === name}
            onClick={() => setPreset(name)}
          >
            {name}
          </ControlButton>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <text
          style={{
            color: MUTED,
            fontSize: 9,
            fontWeight: 600,
          }}
        >
          TARGET
        </text>

        {FPS_OPTIONS.map((fps) => (
          <ControlButton
            key={fps}
            active={targetFps === fps}
            onClick={() => setTargetFps(fps)}
          >
            {fps}
          </ControlButton>
        ))}

        <ControlButton active={targetFps === 0} onClick={() => setTargetFps(0)}>
          UNLIMITED
        </ControlButton>
      </div>

      <div
        style={{
          display: "flex",
          gap: 32,
        }}
      >
        <Stat label="SPEED" value={`${config.speed} px/s`} />

        <Stat label="NOTES" value={config.notes.toLocaleString()} />

        <Stat label="LANES" value={`${LANES}K`} />

        <Stat
          label="TARGET"
          value={targetFps === 0 ? "Unlimited" : `${targetFps} Hz`}
        />

        <Stat label="TORTURE" value={torture ? "ON" : "OFF"} />
      </div>
    </div>
  );
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function StatsOverlay({
  avgMs,
  minMs,
  maxMs,
  jitter,
  fps,
  targetFps,
  visibleNotes,
  totalNotes,
  speed,
  droppedFrames,
}: {
  avgMs: number;
  minMs: number;
  maxMs: number;
  jitter: number;
  fps: number;
  targetFps: number;
  visibleNotes: number;
  totalNotes: number;
  speed: number;
  droppedFrames: number;
}) {
  const targetMs = targetFps > 0 ? 1000 / targetFps : 0;

  const frameWarn = targetMs > 0 && avgMs > targetMs * 1.25;

  const jitterWarn = jitter > 8;

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        top: 12,
        padding: 10,
        borderRadius: 8,
        backgroundColor: PANEL,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 140,
      }}
    >
      <text
        style={{
          color: TEXT,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        RENDER STATS
      </text>

      <Stat label="FPS (actual)" value={fps.toString()} warn={frameWarn} />

      <Stat label="FRAME (avg ms)" value={avgMs.toFixed(2)} warn={frameWarn} />

      <Stat label="FRAME (min ms)" value={minMs.toFixed(2)} />

      <Stat label="FRAME (max ms)" value={maxMs.toFixed(2)} />

      <Stat label="JITTER ms" value={jitter.toFixed(2)} warn={jitterWarn} />

      <Stat
        label="DROPPED FRAMES"
        value={droppedFrames.toString()}
        warn={droppedFrames > 0}
      />

      <Stat label="VISIBLE / TOTAL" value={`${visibleNotes} / ${totalNotes}`} />

      <Stat label="SPEED" value={`${speed} px/s`} />
    </div>
  );
}

// ─── Playfield ──────────────────────────────────────────────────────────────

function ManiaPlayfield({
  speed,
  noteCount,
  spacing,
  paused,
  targetFps,
  torture,
  glow,
}: {
  speed: number;
  noteCount: number;
  spacing: number;
  paused: boolean;
  targetFps: number;
  torture: boolean;
  glow: boolean;
}) {
  type Chart = {
    count: number;
    lane: Uint8Array;
    y: Float64Array;
    width: Float32Array;
    height: Float32Array;
    alpha: Float32Array;
  };

  const createChart = (
    count: number,
    spacing: number,
    torture: boolean,
  ): Chart => {
    /*
     * Keep the benchmark at exactly `count` notes.
     *
     * The old implementation could create more than `count`
     * because some patterns generated two notes.
     */
    const lane = new Uint8Array(count);
    const y = new Float64Array(count);
    const width = new Float32Array(count);
    const height = new Float32Array(count);
    const alpha = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const pattern = i % 13;

      let selectedLane: number;

      if (pattern === 5 || pattern === 9) {
        /*
         * Alternating adjacent lanes gives a similar
         * jack/chord-like distribution without changing
         * the total benchmark note count.
         */
        const base = Math.floor(Math.random() * LANES);

        selectedLane = i % 2 === 0 ? base : Math.min(LANES - 1, base + 1);
      } else if (pattern === 12) {
        selectedLane = [0, 2, 4, 6][i % 4];
      } else {
        selectedLane = Math.floor(Math.random() * LANES);
      }

      lane[i] = selectedLane;
      y[i] = -i * spacing;

      width[i] = torture ? 86 + Math.floor(Math.random() * 10) : 86;

      height[i] = torture
        ? NOTE_HEIGHT + Math.floor(Math.random() * 6)
        : NOTE_HEIGHT;

      alpha[i] = torture ? 0.75 + Math.random() * 0.25 : 1;
    }

    return {
      count,
      lane,
      y,
      width,
      height,
      alpha,
    };
  };

  const chartRef = useRef<Chart>(createChart(noteCount, spacing, torture));

  /*
   * `revision` is deliberately separate from the chart.
   *
   * Chart data is mutated in-place.
   * revision only tells React that the styles of the
   * retained note elements need to be reconciled.
   */
  const [revision, setRevision] = useState(0);

  const [renderStats, setRenderStats] = useState({
    avgMs: 0,
    minMs: 0,
    maxMs: 0,
    jitter: 0,
    fps: 0,
    visibleNotes: 0,
    droppedFrames: 0,
  });

  const { push, stats } = useFrameStats();

  const pausedRef = useRef(paused);

  const speedRef = useRef(speed);

  const targetFpsRef = useRef(targetFps);

  const lastTimeRef = useRef<number | null>(null);

  const lastStatsRef = useRef(0);

  const droppedRef = useRef(0);

  // ── Synchronize mutable refs ───────────────────────────────────────────

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    targetFpsRef.current = targetFps;
  }, [targetFps]);

  // ── Rebuild chart ───────────────────────────────────────────────────────

  useEffect(() => {
    chartRef.current = createChart(noteCount, spacing, torture);

    setRevision((value) => value + 1);
  }, [noteCount, spacing, torture]);

  // ── Native-runtime animation loop ──────────────────────────────────────

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    let running = true;

    const chart = chartRef.current;

    const totalHeight = noteCount * spacing + PLAYFIELD_HEIGHT;

    lastTimeRef.current = null;

    lastStatsRef.current = performance.now();

    droppedRef.current = 0;

    const tick = () => {
      if (!running) {
        return;
      }

      const now = performance.now();

      const previous = lastTimeRef.current;

      if (previous === null) {
        lastTimeRef.current = now;

        timer = setTimeout(tick, 0);

        return;
      }

      const dt = now - previous;

      const currentTarget = targetFpsRef.current;

      const targetInterval = currentTarget > 0 ? 1000 / currentTarget : 0;

      /*
       * Manual FPS limiter.
       *
       * requestAnimationFrame is intentionally not used:
       * GPUIX is not a browser environment.
       */
      if (targetInterval > 0 && dt < targetInterval - 0.5) {
        timer = setTimeout(tick, 0);

        return;
      }

      // ── Frame timing ────────────────────────────────────────────────────

      push(dt);

      if (targetInterval > 0 && dt > targetInterval * 2) {
        droppedRef.current++;
      }

      lastTimeRef.current = now;

      // ── Move notes ──────────────────────────────────────────────────────

      if (!pausedRef.current) {
        const deltaSeconds = Math.min(dt, 100) / 1000;

        const movement = speedRef.current * deltaSeconds;

        /*
         * HOT PATH
         *
         * No object allocations.
         * No Array.map().
         * No Note objects.
         *
         * Just mutate the Y position buffer.
         */
        for (let i = 0; i < chart.count; i++) {
          let y = chart.y[i] + movement;

          if (y > RECEPTOR_Y + RECEPTOR_HEIGHT) {
            y -= totalHeight;
          }

          chart.y[i] = y;
        }

        /*
         * One React update for the whole frame.
         *
         * React then diffs the visible note elements.
         */
        setRevision((value) => value + 1);
      }

      // ── Stats ───────────────────────────────────────────────────────────

      if (now - lastStatsRef.current >= 1000) {
        const result = stats();

        setRenderStats({
          avgMs: result.avg,
          minMs: result.min,
          maxMs: result.max,
          jitter: result.jitter,
          fps: result.fps,
          visibleNotes: 0,
          droppedFrames: droppedRef.current,
        });

        droppedRef.current = 0;

        lastStatsRef.current = now;
      }

      timer = setTimeout(tick, 0);
    };

    tick();

    return () => {
      running = false;

      if (timer !== undefined) {
        clearTimeout(timer);
      }

      lastTimeRef.current = null;
    };
  }, [noteCount, spacing]);

  // ── Visible notes ───────────────────────────────────────────────────────

  /*
   * We only create GPUIX elements for notes currently inside
   * the playfield.
   *
   * This is the important part for the Meltdown test:
   *
   * 4000 total notes
   * !=
   * 4000 GPUIX elements every frame
   *
   * Only visible notes become elements.
   */
  const visibleIndexes = useMemo(() => {
    const chart = chartRef.current;

    const visible: number[] = [];

    for (let i = 0; i < chart.count; i++) {
      const y = chart.y[i];

      if (y >= -NOTE_HEIGHT && y <= RECEPTOR_Y) {
        visible.push(i);
      }
    }

    return visible;
  }, [revision]);

  const chart = chartRef.current;

  const laneWidth = PLAYFIELD_WIDTH / LANES;

  // ── Lane background ─────────────────────────────────────────────────────

  const laneBackgrounds = useMemo(
    () =>
      Array.from(
        {
          length: LANES,
        },
        (_, lane) => (
          <div
            key={`lane-${lane}`}
            style={{
              position: "absolute",
              left: lane * laneWidth,
              top: 0,
              width: laneWidth,
              height: RECEPTOR_Y,
              backgroundColor: lane % 2 === 0 ? "#0b0e13" : "#0e1117",
            }}
          />
        ),
      ),
    [laneWidth],
  );

  // ── Lane separators ─────────────────────────────────────────────────────

  const laneSeparators = useMemo(
    () =>
      Array.from(
        {
          length: LANES - 1,
        },
        (_, lane) => (
          <div
            key={`separator-${lane}`}
            style={{
              position: "absolute",
              left: (lane + 1) * laneWidth - 1,
              top: 0,
              width: 2,
              height: RECEPTOR_Y,
              backgroundColor: BORDER,
            }}
          />
        ),
      ),
    [laneWidth],
  );

  // ── Glow ─────────────────────────────────────────────────────────────────

  const glowElements = useMemo(() => {
    if (!glow) {
      return null;
    }

    const counts = new Uint32Array(LANES);

    for (const index of visibleIndexes) {
      counts[chart.lane[index]]++;
    }

    return Array.from(
      {
        length: LANES,
      },
      (_, lane) => (
        <div
          key={`glow-${lane}`}
          style={{
            position: "absolute",
            left: lane * laneWidth,
            top: 0,
            width: laneWidth,
            height: RECEPTOR_Y,
            backgroundColor: LANE_COLORS[lane],
            opacity: 0.04 + (counts[lane] / Math.max(1, noteCount)) * 0.06,
          }}
        />
      ),
    );
  }, [glow, visibleIndexes, chart, laneWidth, noteCount]);

  // ── Notes ───────────────────────────────────────────────────────────────

  /*
   * IMPORTANT:
   *
   * Exactly ONE GPUIX element per visible note.
   *
   * There is no:
   *
   *   <div>
   *     <div glow />
   *     <div note />
   *   </div>
   *
   * anymore.
   *
   * Glow is represented by the same element using a border/shadow-like
   * visual approximation through the available GPUIX styles.
   */

  const noteElements = visibleIndexes.map((index) => {
    const lane = chart.lane[index];

    const y = chart.y[index];

    const width = chart.width[index];

    const height = chart.height[index];

    const alpha = chart.alpha[index];

    const left = lane * laneWidth + (laneWidth - width) / 2;

    const color = LANE_COLORS[lane];

    return (
      <div
        key={index}
        style={{
          position: "absolute",

          left,

          top: y,

          width,

          height,

          borderRadius: 5,

          backgroundColor: color,

          opacity: alpha,

          /*
           * Torture mode deliberately makes each note
           * visually distinct.
           *
           * Keep the normal path extremely simple.
           */
          ...(glow
            ? {
                borderWidth: 2,
                borderColor: color,
              }
            : {}),
        }}
      />
    );
  });

  // ── Receptors ───────────────────────────────────────────────────────────

  const receptors = useMemo(
    () =>
      Array.from(
        {
          length: LANES,
        },
        (_, lane) => (
          <div
            key={`receptor-${lane}`}
            style={{
              position: "absolute",
              left: lane * laneWidth + 7,
              top: RECEPTOR_Y + 10,
              width: laneWidth - 14,
              height: RECEPTOR_HEIGHT,
              borderRadius: 5,
              backgroundColor: "#252d3a",
            }}
          />
        ),
      ),
    [laneWidth],
  );

  return (
    <div
      style={{
        position: "relative",

        width: PLAYFIELD_WIDTH,

        height: PLAYFIELD_HEIGHT,

        backgroundColor: PLAYFIELD,

        borderRadius: 12,

        overflow: "hidden",
      }}
    >
      {laneBackgrounds}

      {laneSeparators}

      {glowElements}

      {noteElements}

      {/* Receptor zone */}

      <div
        style={{
          position: "absolute",
          left: 0,
          top: RECEPTOR_Y,
          width: PLAYFIELD_WIDTH,
          height: PLAYFIELD_HEIGHT - RECEPTOR_Y,
          backgroundColor: "#11151d",
        }}
      />

      {/* Hit line */}

      <div
        style={{
          position: "absolute",
          left: 0,
          top: RECEPTOR_Y,
          width: PLAYFIELD_WIDTH,
          height: 3,
          backgroundColor: ACCENT,
        }}
      />

      {receptors}

      {/* Stats */}

      <StatsOverlay
        avgMs={renderStats.avgMs}
        minMs={renderStats.minMs}
        maxMs={renderStats.maxMs}
        jitter={renderStats.jitter}
        fps={renderStats.fps}
        targetFps={targetFps}
        visibleNotes={visibleIndexes.length}
        totalNotes={chart.count}
        speed={speed}
        droppedFrames={renderStats.droppedFrames}
      />
    </div>
  );
}
// ─── App ────────────────────────────────────────────────────────────────────

function BenchmarkApp() {
  const [preset, setPreset] = useState<PresetName>("Dense");

  const [targetFps, setTargetFps] = useState(240);

  const [paused, setPaused] = useState(false);

  const [torture, setTorture] = useState(false);

  const [glow, setGlow] = useState(false);

  const config = PRESETS[preset];

  return (
    <div
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minHeight: 0,
        backgroundColor: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 20,
        gap: 12,
      }}
    >
      <Header
        preset={preset}
        setPreset={setPreset}
        paused={paused}
        setPaused={setPaused}
        targetFps={targetFps}
        setTargetFps={setTargetFps}
        torture={torture}
        setTorture={setTorture}
        glow={glow}
        setGlow={setGlow}
      />

      <ManiaPlayfield
        speed={config.speed}
        noteCount={config.notes}
        spacing={config.spacing}
        paused={paused}
        targetFps={targetFps}
        torture={torture}
        glow={glow}
      />
    </div>
  );
}

// ─── GPUIX ──────────────────────────────────────────────────────────────────
//
// GPUIX provides its own native frame loop.
// The debug overlay measures native GPUI draw time and is preferable
// to a React-updated FPS counter when measuring renderer performance.
//

// ─── Root (mode switch) ──────────────────────────────────────────────────────

import { Playground } from "./playground";

function Root() {
  const [mode, setMode] = useState<"benchmark" | "playground">("benchmark");

  return (
    <div style={{ height: "100%", backgroundColor: BG, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 8,
          paddingLeft: 16,
          backgroundColor: PANEL,
          borderColor: BORDER,
          borderBottomWidth: 1,
        }}
      >
        <text style={{ color: ACCENT, fontSize: 11, fontWeight: 700, marginRight: 8 }}>
          ROXYSU / PLAY
        </text>

        <div
          onClick={() => setMode("benchmark")}
          style={{
            padding: 7,
            borderRadius: 6,
            backgroundColor: mode === "benchmark" ? ACCENT : PANEL_HOVER,
            cursor: "pointer",
          }}
        >
          <text style={{ color: mode === "benchmark" ? BG : TEXT, fontSize: 10, fontWeight: 600 }}>
            BENCHMARK
          </text>
        </div>

        <div
          onClick={() => setMode("playground")}
          style={{
            padding: 7,
            borderRadius: 6,
            backgroundColor: mode === "playground" ? ACCENT : PANEL_HOVER,
            cursor: "pointer",
          }}
        >
          <text style={{ color: mode === "playground" ? BG : TEXT, fontSize: 10, fontWeight: 600 }}>
            DESIGN SYSTEM
          </text>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexBasis: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {mode === "benchmark" ? <BenchmarkApp /> : <Playground />}
      </div>
    </div>
  );
}

render(<Root />, gpuixRenderOptions({
  title: "Roxysu VSRG Benchmark",

  appName: "Roxysu VSRG Benchmark",

  width: 820,
  height: 860,

  titlebarTransparent: true,

  windowBackground: "opaque",

  debugFrameOverlay: "full",
}));
