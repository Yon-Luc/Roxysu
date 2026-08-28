import { useMemo } from "react";
import type { EventPayload } from "@gpuix/react";
import {
  Button,
  HStack,
  colors,
} from "../components/ui";
import type { Game } from "../game/Game";

const LANE_COLORS = [
  "#7dd3fc",
  "#93c5fd",
  "#6ee7b7",
  "#67e8f9",
  "#a78bfa",
  "#f9a8d4",
  "#fcd34d",
];

const RECEPTOR_HEIGHT = 22;

type PlayViewProps = {
  game: Game;
  frameVersion: number;
  songTimeMs: number;
  combo: number;
  score: number;
  accuracy: number;
  phase: "PLAYING" | "PAUSED";
};

export function PlayView({
  game,
  frameVersion,
  songTimeMs,
  combo,
  score,
  accuracy,
  phase,
}: PlayViewProps) {
  void frameVersion;
  const snapshot = game.playfield.getSnapshot();

  const laneBackgrounds = useMemo(
    () =>
      Array.from({ length: snapshot.lanes }, (_, lane) => (
        <div
          key={`lane-bg-${lane}`}
          style={{
            position: "absolute",
            left: lane * snapshot.laneWidth,
            top: 0,
            width: snapshot.laneWidth,
            height: snapshot.receptorY,
            backgroundColor: lane % 2 === 0 ? "#0b0e13" : "#0e1117",
          }}
        />
      )),
    [snapshot.lanes, snapshot.laneWidth, snapshot.receptorY],
  );

  const laneSeparators = useMemo(
    () =>
      Array.from({ length: snapshot.lanes - 1 }, (_, lane) => (
        <div
          key={`sep-${lane}`}
          style={{
            position: "absolute",
            left: (lane + 1) * snapshot.laneWidth - 1,
            top: 0,
            width: 2,
            height: snapshot.receptorY,
            backgroundColor: colors.border,
          }}
        />
      )),
    [snapshot.lanes, snapshot.laneWidth, snapshot.receptorY],
  );

  const receptors = useMemo(
    () =>
      Array.from({ length: snapshot.lanes }, (_, lane) => (
        <div
          key={`receptor-${lane}`}
          style={{
            position: "absolute",
            left: lane * snapshot.laneWidth + 7,
            top: snapshot.receptorY + 10,
            width: snapshot.laneWidth - 14,
            height: RECEPTOR_HEIGHT,
            borderRadius: 5,
            backgroundColor: "#252d3a",
          }}
        />
      )),
    [snapshot.lanes, snapshot.laneWidth, snapshot.receptorY],
  );

  const notes = [];
  for (let i = 0; i < snapshot.visibleCount; i += 1) {
    const lane = snapshot.lane[i]!;
    const y = snapshot.y[i]!;
    const height = snapshot.noteHeight[i]!;
    const alpha = snapshot.alpha[i]!;

    notes.push(
      <div
        key={`note-${i}-${Math.round(y)}`}
        style={{
          position: "absolute",
          left: lane * snapshot.laneWidth + 4,
          top: y,
          width: snapshot.laneWidth - 8,
          height,
          borderRadius: 4,
          backgroundColor: LANE_COLORS[lane % LANE_COLORS.length],
          opacity: alpha,
        }}
      />,
    );
  }

  const onKeyDown = (event: EventPayload) => {
    game.input.handleKeyDown(event, game.getSongTimeMs());
  };

  const onKeyUp = (event: EventPayload) => {
    game.input.handleKeyUp(event, game.getSongTimeMs());
  };

  return (
    <div
      tabIndex={0}
      autoFocus
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: snapshot.width,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <text style={{ color: colors.foreground, fontSize: 12, fontWeight: 600 }}>
          {Math.floor(songTimeMs / 1000)}s
        </text>
        <text style={{ color: colors.primary, fontSize: 12, fontWeight: 600 }}>
          {combo}x combo
        </text>
        <text style={{ color: colors.foreground, fontSize: 12, fontWeight: 600 }}>
          {(accuracy * 100).toFixed(2)}%
        </text>
        <text style={{ color: colors.foreground, fontSize: 12, fontWeight: 600 }}>
          {score.toLocaleString()}
        </text>
      </div>

      <div
        style={{
          position: "relative",
          width: snapshot.width,
          height: snapshot.playfieldHeight,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: "#080a0e",
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {laneBackgrounds}
        {laneSeparators}

        <div
          style={{
            position: "absolute",
            left: 0,
            top: snapshot.receptorY,
            width: snapshot.width,
            height: snapshot.playfieldHeight - snapshot.receptorY,
            backgroundColor: "#11151d",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 0,
            top: snapshot.receptorY,
            width: snapshot.width,
            height: 3,
            backgroundColor: colors.primary,
          }}
        />

        {receptors}
        {notes}

        {game.judgmentEffects.getPopups().map((popup) => (
          <text
            key={popup.id}
            style={{
              position: "absolute",
              left: popup.lane * snapshot.laneWidth + 8,
              top: snapshot.receptorY - 28,
              color: colors.primary,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {popup.label}
          </text>
        ))}
      </div>

      <text style={{ color: colors.mutedForeground, fontSize: 10 }}>
        Keys: S D F Space J K L
      </text>

      <HStack gap="sm">
        <Button
          variant="secondary"
          disabled={phase !== "PLAYING"}
          onClick={() => game.pause()}
        >
          Pause
        </Button>
        <Button
          variant="secondary"
          disabled={phase !== "PAUSED"}
          onClick={() => game.resume()}
        >
          Resume
        </Button>
        <Button
          variant="secondary"
          disabled={phase !== "PLAYING"}
          onClick={() => game.restart()}
        >
          Restart
        </Button>
        <Button variant="outline" onClick={() => game.finish()}>
          End
        </Button>
      </HStack>
    </div>
  );
}
