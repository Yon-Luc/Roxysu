import { useEffect, useRef, useState } from "react";
import { colors, HStack, Stack, Text } from "../components/ui";
import { toSkinAssetUrl } from "../skin/skinFileLookup";
import {
  primeTextureTestForMode,
  TEXTURE_TEST_PATH_A,
  TEXTURE_TEST_PATH_B,
  TEXTURE_TEST_PATH_SAME,
  TEXTURE_TEST_RING_SIZE,
  TEXTURE_TEST_SIZE,
  textureTestRingPath,
  type TextureTestMode,
  writeTextureRefreshFrame,
  writeTextureRefreshFrameSamePath,
  textureTestBarY,
} from "./textureRefreshTestPngs";

const STABLE_IMG_KEY = "playfield-surface";

/** Preset frame intervals (ms). 0 = uncapped (setTimeout 0). */
export const TEXTURE_TEST_FRAME_PRESETS = [
  { label: "60", ms: 16 },
  { label: "120", ms: 8 },
  { label: "240", ms: 4 },
  { label: "∞", ms: 0 },
] as const;

function resolveInitialFrameMs(): number {
  const raw = process.env.TEXTURE_TEST_FRAME_MS;
  if (raw === "0" || raw === "uncapped") return 0;
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 8;
}

export type TextureRefreshTestProps = {
  /** A = same path overwrite, B = A/B ping-pong, C = ring buffer */
  initialMode?: TextureTestMode;
  /** Frame interval in ms; 0 = uncapped. Default 8 (~120 Hz) or TEXTURE_TEST_FRAME_MS. */
  initialFrameMs?: number;
};

function parseMode(value: string | undefined): TextureTestMode {
  if (value === "A" || value === "B" || value === "C") return value;
  return "B";
}

function resolveInitialMode(initialMode?: TextureTestMode): TextureTestMode {
  if (initialMode) return initialMode;
  return parseMode(process.env.TEXTURE_TEST_MODE);
}

/**
 * Isolated GPUI texture refresh experiment.
 *
 * Exactly ONE <img>, stable key, src changes only.
 * Never overwrites the path currently displayed (modes B and C).
 */
export function TextureRefreshTest({
  initialMode,
  initialFrameMs,
}: TextureRefreshTestProps = {}) {
  const [mode, setMode] = useState<TextureTestMode>(() =>
    resolveInitialMode(initialMode),
  );
  const [frameIntervalMs, setFrameIntervalMs] = useState(() =>
    initialFrameMs ?? resolveInitialFrameMs(),
  );
  const [frameVersion, setFrameVersion] = useState(0);
  const [animTimeMs, setAnimTimeMs] = useState(0);
  const [measuredFps, setMeasuredFps] = useState(0);
  const [srcPath, setSrcPath] = useState(() => TEXTURE_TEST_PATH_A);

  const runningRef = useRef(true);
  const frameRef = useRef(0);
  const animStartRef = useRef(performance.now());
  const displayedPathRef = useRef<string | null>(null);
  const modeRef = useRef(mode);
  const frameIntervalMsRef = useRef(frameIntervalMs);
  const lastStatsAtRef = useRef(performance.now());
  const framesSinceStatsRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    frameIntervalMsRef.current = frameIntervalMs;
  }, [frameIntervalMs]);

  useEffect(() => {
    primeTextureTestForMode(mode);
    frameRef.current = 0;
    animStartRef.current = performance.now();
    displayedPathRef.current = null;
    setFrameVersion(0);
    setAnimTimeMs(0);

    if (mode === "A") {
      writeTextureRefreshFrameSamePath(TEXTURE_TEST_PATH_SAME, 0);
      displayedPathRef.current = TEXTURE_TEST_PATH_SAME;
      setSrcPath(TEXTURE_TEST_PATH_SAME);
    } else if (mode === "B") {
      writeTextureRefreshFrame(TEXTURE_TEST_PATH_A, "A", 0);
      displayedPathRef.current = TEXTURE_TEST_PATH_A;
      setSrcPath(TEXTURE_TEST_PATH_A);
    } else {
      const path0 = textureTestRingPath(0);
      writeTextureRefreshFrame(path0, "A", 0);
      displayedPathRef.current = path0;
      setSrcPath(path0);
    }
  }, [mode]);

  useEffect(() => {
    runningRef.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (!runningRef.current) return;

      const currentMode = modeRef.current;
      const next = frameRef.current + 1;
      frameRef.current = next;
      const timeMs = performance.now() - animStartRef.current;

      let nextPath = displayedPathRef.current ?? TEXTURE_TEST_PATH_A;

      if (currentMode === "A") {
        writeTextureRefreshFrameSamePath(TEXTURE_TEST_PATH_SAME, timeMs);
        nextPath = TEXTURE_TEST_PATH_SAME;
      } else if (currentMode === "B") {
        const useA = next % 2 === 0;
        nextPath = useA ? TEXTURE_TEST_PATH_A : TEXTURE_TEST_PATH_B;
        if (nextPath !== displayedPathRef.current) {
          writeTextureRefreshFrame(nextPath, useA ? "A" : "B", timeMs);
        }
      } else {
        const slot = next % TEXTURE_TEST_RING_SIZE;
        nextPath = textureTestRingPath(slot);
        if (nextPath !== displayedPathRef.current) {
          writeTextureRefreshFrame(
            nextPath,
            slot % 2 === 0 ? "A" : "B",
            timeMs,
          );
        }
      }

      displayedPathRef.current = nextPath;
      setSrcPath(nextPath);
      setFrameVersion(next);
      setAnimTimeMs(timeMs);

      framesSinceStatsRef.current += 1;
      const now = performance.now();
      if (now - lastStatsAtRef.current >= 1000) {
        setMeasuredFps(framesSinceStatsRef.current);
        framesSinceStatsRef.current = 0;
        lastStatsAtRef.current = now;
      }

      if (next % 120 === 0) {
        console.log(
          `[texture-test:${currentMode}] frame=${next} timeMs=${Math.round(timeMs)} src=${nextPath} barY≈${textureTestBarY(timeMs)} intervalMs=${frameIntervalMsRef.current}`,
        );
      }

      const delay = frameIntervalMsRef.current;
      timer = setTimeout(tick, delay <= 0 ? 0 : delay);
    };

    lastStatsAtRef.current = performance.now();
    framesSinceStatsRef.current = 0;
    const delay = frameIntervalMsRef.current;
    timer = setTimeout(tick, delay <= 0 ? 0 : delay);

    return () => {
      runningRef.current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  const src = toSkinAssetUrl(srcPath);
  const barY = textureTestBarY(animTimeMs);

  return (
    <Stack
      gap="md"
      style={{
        padding: 24,
        alignItems: "center",
        backgroundColor: colors.background,
        height: "100%",
      }}
    >
      <Stack gap="xs" style={{ alignItems: "center", maxWidth: 560 }}>
        <Text size="lg" weight="bold">
          GPUI texture refresh — tests A / B / C
        </Text>
        <Text size="sm" muted style={{ textAlign: "center" }}>
          One stable {"<img key=\"playfield-surface\">"} · bar speed is time-based
          (300ms/cycle) · refresh{" "}
          {frameIntervalMs <= 0
            ? "uncapped"
            : `~${Math.round(1000 / frameIntervalMs)} Hz`}
        </Text>
      </Stack>

      <HStack gap="sm">
        {(["A", "B", "C"] as const).map((m) => (
          <div
            key={m}
            onClick={() => setMode(m)}
            style={{
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 14,
              paddingRight: 14,
              borderRadius: 6,
              cursor: "pointer",
              backgroundColor: mode === m ? colors.primary : colors.muted,
            }}
          >
            <text
              style={{
                color: mode === m ? colors.background : colors.foreground,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Test {m}
            </text>
          </div>
        ))}
      </HStack>

      <HStack gap="sm">
        {TEXTURE_TEST_FRAME_PRESETS.map((preset) => (
          <div
            key={preset.label}
            onClick={() => setFrameIntervalMs(preset.ms)}
            style={{
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: 6,
              cursor: "pointer",
              backgroundColor:
                frameIntervalMs === preset.ms ? colors.primary : colors.muted,
            }}
          >
            <text
              style={{
                color:
                  frameIntervalMs === preset.ms
                    ? colors.background
                    : colors.foreground,
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              {preset.label === "∞" ? "∞ uncapped" : `${preset.label} fps`}
            </text>
          </div>
        ))}
      </HStack>

      <Text size="xs" muted style={{ textAlign: "center", maxWidth: 520 }}>
        {mode === "A" &&
          "Same path overwrite — expect frozen bar if GPUI caches by path."}
        {mode === "B" &&
          "A↔B ping-pong — colors flip; bar moves only if path reload reads fresh bytes."}
        {mode === "C" &&
          `Ring ${TEXTURE_TEST_RING_SIZE} paths — bar should move; watch atlas errors after ~${TEXTURE_TEST_RING_SIZE} frames.`}
      </Text>

      <div
        style={{
          position: "relative",
          width: TEXTURE_TEST_SIZE.width,
          height: TEXTURE_TEST_SIZE.height,
          borderWidth: 2,
          borderColor: colors.border,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <img
          key={STABLE_IMG_KEY}
          src={src}
          objectFit="fill"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: TEXTURE_TEST_SIZE.width,
            height: TEXTURE_TEST_SIZE.height,
          }}
        />
      </div>

      <Stack gap="xs" style={{ alignItems: "center", maxWidth: 560 }}>
        <Text size="sm">
          mode {mode} · frame {frameVersion} · measured {measuredFps} fps · bar
          Y ≈ {barY}px
        </Text>
        <Text size="xs" muted>
          src: {src}
        </Text>
      </Stack>

      <Stack gap="xs" style={{ maxWidth: 560 }}>
        <Text size="xs" muted>
          Pass: bar moves at same speed at 60/120/∞; higher Hz = smoother steps only.
        </Text>
        <Text size="xs" muted>
          See playfield/texture-refresh-findings.md for GPUI cache notes.
        </Text>
      </Stack>
    </Stack>
  );
}
