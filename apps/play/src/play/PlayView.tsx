import { useMemo } from "react";
import type { EventPayload } from "@gpuix/react";
import {
  Button,
  HStack,
  colors,
} from "../components/ui";
import type { Game } from "../game/Game";
import { toSkinAssetUrl } from "../skin/skinFileLookup";

type PlayViewProps = {
  game: Game;
  frameVersion: number;
  songTimeMs: number;
  combo: number;
  score: number;
  accuracy: number;
  phase: "PLAYING" | "PAUSED";
};

type SpriteStyle = {
  left: number;
  top: number;
  width: number;
  height: number;
  opacity?: number;
};

function SkinSprite({ src, style }: { src: string; style: SpriteStyle }) {
  return (
    <img
      src={toSkinAssetUrl(src)}
      style={{
        position: "absolute",
        left: style.left,
        top: style.top,
        width: style.width,
        height: style.height,
        opacity: style.opacity ?? 1,
      }}
    />
  );
}

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
  const skin = game.getPlayfieldSkin();
  const sprites = skin.sprites;

  const stageSprites = useMemo(() => {
    if (!sprites) return null;
    const items = [];
    if (sprites.stageLeft) {
      items.push(
        <SkinSprite
          key="stage-left"
          src={sprites.stageLeft}
          style={{
            left: 0,
            top: 0,
            width: Math.min(96, snapshot.width * 0.12),
            height: snapshot.receptorY,
          }}
        />,
      );
    }
    if (sprites.stageRight) {
      const width = Math.min(96, snapshot.width * 0.12);
      items.push(
        <SkinSprite
          key="stage-right"
          src={sprites.stageRight}
          style={{
            left: snapshot.width - width,
            top: 0,
            width,
            height: snapshot.receptorY,
          }}
        />,
      );
    }
    return items;
  }, [sprites, snapshot.receptorY, snapshot.width]);

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
            backgroundColor:
              lane % 2 === 0
                ? skin.laneBackgroundEven
                : skin.laneBackgroundOdd,
          }}
        />
      )),
    [
      snapshot.lanes,
      snapshot.laneWidth,
      snapshot.receptorY,
      skin.laneBackgroundEven,
      skin.laneBackgroundOdd,
    ],
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
      Array.from({ length: snapshot.lanes }, (_, lane) => {
        const left = lane * snapshot.laneWidth + 7;
        const top = snapshot.receptorY + 10;
        const width = snapshot.laneWidth - 14;
        const height = skin.receptorHeight;
        const keySprite = sprites?.keysUp[lane];

        if (keySprite) {
          return (
            <SkinSprite
              key={`receptor-${lane}`}
              src={keySprite}
              style={{ left, top, width, height }}
            />
          );
        }

        return (
          <div
            key={`receptor-${lane}`}
            style={{
              position: "absolute",
              left,
              top,
              width,
              height,
              borderRadius: 5,
              backgroundColor: skin.receptorFill,
            }}
          />
        );
      }),
    [snapshot.lanes, snapshot.laneWidth, snapshot.receptorY, skin, sprites],
  );

  const notes = [];
  for (let i = 0; i < snapshot.visibleCount; i += 1) {
    const lane = snapshot.lane[i]!;
    const y = snapshot.y[i]!;
    const height = snapshot.noteHeight[i]!;
    const alpha = snapshot.alpha[i]!;
    const left = lane * snapshot.laneWidth + skin.notePadding;
    const width = snapshot.laneWidth - skin.notePadding * 2;
    const noteSprite = sprites?.notes[lane];

    notes.push(
      noteSprite ? (
        <SkinSprite
          key={`note-${i}-${Math.round(y)}`}
          src={noteSprite}
          style={{ left, top: y, width, height, opacity: alpha }}
        />
      ) : (
        <div
          key={`note-${i}-${Math.round(y)}`}
          style={{
            position: "absolute",
            left,
            top: y,
            width,
            height,
            borderRadius: skin.noteBorderRadius,
            backgroundColor: skin.laneColors[lane % skin.laneColors.length],
            opacity: alpha,
          }}
        />
      ),
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
          backgroundColor: skin.playfieldBackground,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {stageSprites}
        {laneBackgrounds}
        {laneSeparators}

        <div
          style={{
            position: "absolute",
            left: 0,
            top: snapshot.receptorY,
            width: snapshot.width,
            height: snapshot.playfieldHeight - snapshot.receptorY,
            backgroundColor: skin.belowReceptorBackground,
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 0,
            top: snapshot.receptorY,
            width: snapshot.width,
            height: 3,
            backgroundColor: skin.judgmentLineColor,
          }}
        />

        {notes}
        {receptors}

        {game.judgmentEffects.getPopups(skin).map((popup) => (
          <text
            key={popup.id}
            style={{
              position: "absolute",
              left: popup.lane * snapshot.laneWidth + 8,
              top: snapshot.receptorY - 28,
              color: popup.color,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {popup.label}
          </text>
        ))}
      </div>

      <text style={{ color: colors.mutedForeground, fontSize: 10 }}>
        Keys: {game.getKeyBindingsHint()} · Skin: {skin.name}
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
