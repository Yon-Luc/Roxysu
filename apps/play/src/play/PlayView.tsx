import { useMemo } from "react";
import type { EventPayload } from "@gpuix/react";
import {
  Button,
  HStack,
  colors,
} from "../components/ui";
import type { Game } from "../game/Game";
import type { PlayfieldColumnSnapshot } from "../playfield/PlayfieldTypes";
import {
  HoldBodiesLayer,
  type HoldBodiesLayerContent,
} from "../playfield/HoldBodiesLayer";
import type { HoldBodyDraw } from "../playfield/holdBodyTiled";
import { toSkinAssetUrl } from "../skin/skinFileLookup";
import { buildPlayfieldSkinLayout, spriteDestHeight } from "../skin/skinLayout";
import { OSU_MANIA_HEIGHT } from "../integrations/osu-skin-ini";
import {
  HIT_POSITION_DEFAULT,
  type PlaySettings,
} from "../settings/PlaySettings";

type PlayViewProps = {
  game: Game;
  settings: PlaySettings;
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

function SkinSprite({
  src,
  style,
  objectFit = "fill",
}: {
  src: string;
  style: SpriteStyle;
  objectFit?: "fill" | "contain" | "cover" | "scaleDown" | "none";
}) {
  return (
    <img
      src={toSkinAssetUrl(src)}
      objectFit={objectFit}
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

function columnForLane(
  columns: readonly PlayfieldColumnSnapshot[],
  lane: number,
): PlayfieldColumnSnapshot {
  return (
    columns[lane] ?? {
      x: 0,
      w: 0,
      tapHeight: 18,
    }
  );
}

function holdNoteLayout(args: {
  startCenterY: number;
  endCenterY: number;
  column: PlayfieldColumnSnapshot;
  tailPath: string | null | undefined;
  spriteSizes: Readonly<Record<string, { w: number; h: number }>>;
}) {
  const { startCenterY, endCenterY, column, tailPath, spriteSizes } = args;
  const tapH = column.tapHeight;
  const noteW = column.w;
  const topCenter = Math.min(startCenterY, endCenterY);
  const bottomCenter = Math.max(startCenterY, endCenterY);
  const tailSize = tailPath ? spriteSizes[tailPath] : null;
  const tailH = tailPath
    ? Math.max(
        6,
        Math.min(spriteDestHeight(tailSize, noteW), tapH * 1.2),
      )
    : 0;
  const bodyTop = topCenter + tailH * 0.45;
  const bodyHeight = Math.max(0, bottomCenter - bodyTop);

  return {
    topCenter,
    bottomCenter,
    bodyTop,
    bodyHeight,
    headTop: startCenterY - tapH / 2,
    tailTop: topCenter - tailH * 0.15,
    tailH,
    tapH,
    noteW,
  };
}

export function PlayView({
  game,
  settings,
  frameVersion,
  songTimeMs,
  combo,
  score,
  accuracy,
  phase,
}: PlayViewProps) {
  const snapshot = game.playfield.getSnapshot();
  const skin = game.getPlayfieldSkin();
  const sprites = skin.sprites;

  const layout = useMemo(() => {
    const hitPosition =
      settings.hitPosition ??
      (skin.maniaLayout
        ? skin.maniaLayout.hitPositionPx / OSU_MANIA_HEIGHT
        : HIT_POSITION_DEFAULT);

    return buildPlayfieldSkinLayout({
      width: snapshot.width,
      height: snapshot.playfieldHeight,
      keys: snapshot.lanes,
      maniaLayout: skin.maniaLayout,
      sprites,
      spriteSizes: skin.spriteSizes,
      align: settings.playfieldAlign,
      hitPosition,
    });
  }, [
    settings.hitPosition,
    settings.playfieldAlign,
    skin.maniaLayout,
    skin.spriteSizes,
    sprites,
    snapshot.width,
    snapshot.playfieldHeight,
    snapshot.lanes,
  ]);

  const columns =
    snapshot.columns.length > 0 ? snapshot.columns : layout.columns;
  const receptorY = snapshot.receptorY;

  const stageSprites = useMemo(() => {
    if (!sprites) return null;
    const items = [];
    if (sprites.stageLeft && layout.stageLeft) {
      items.push(
        <SkinSprite
          key="stage-left"
          src={sprites.stageLeft}
          style={{
            left: layout.stageLeft.x,
            top: layout.stageLeft.y,
            width: layout.stageLeft.w,
            height: layout.stageLeft.h,
          }}
        />,
      );
    }
    if (sprites.stageRight && layout.stageRight) {
      items.push(
        <SkinSprite
          key="stage-right"
          src={sprites.stageRight}
          style={{
            left: layout.stageRight.x,
            top: layout.stageRight.y,
            width: layout.stageRight.w,
            height: layout.stageRight.h,
          }}
        />,
      );
    }
    return items;
  }, [sprites, layout.stageLeft, layout.stageRight]);

  const laneBackgrounds = useMemo(
    () =>
      layout.columns.map((column, lane) => (
        <div
          key={`lane-bg-${lane}`}
          style={{
            position: "absolute",
            left: column.x,
            top: 0,
            width: column.w,
            height: receptorY,
            backgroundColor:
              lane % 2 === 0
                ? skin.laneBackgroundEven
                : skin.laneBackgroundOdd,
          }}
        />
      )),
    [
      layout.columns,
      receptorY,
      skin.laneBackgroundEven,
      skin.laneBackgroundOdd,
    ],
  );

  const laneSeparators = useMemo(
    () =>
      layout.lines.slice(1, -1).map((x, index) => (
        <div
          key={`sep-${index}`}
          style={{
            position: "absolute",
            left: x - 1,
            top: 0,
            width: 2,
            height: receptorY,
            backgroundColor: colors.border,
          }}
        />
      )),
    [layout.lines, receptorY],
  );

  const receptors = useMemo(
    () =>
      layout.columns.map((column, lane) => {
        const keySprite = sprites?.keysUp[lane];
        const tapH = column.tapHeight;
        const top = receptorY - tapH;

        if (keySprite) {
          return (
            <SkinSprite
              key={`receptor-${lane}`}
              src={keySprite}
              style={{
                left: column.x,
                top,
                width: column.w,
                height: tapH,
              }}
            />
          );
        }

        return (
          <div
            key={`receptor-${lane}`}
            style={{
              position: "absolute",
              left: column.x + 7,
              top: receptorY - tapH + 4,
              width: Math.max(8, column.w - 14),
              height: Math.max(8, tapH - 8),
              borderRadius: 5,
              backgroundColor: skin.receptorFill,
            }}
          />
        );
      }),
    [layout.columns, receptorY, skin.receptorFill, skin.receptorHeight, sprites],
  );

  const holdBodiesContent = useMemo((): HoldBodiesLayerContent => {
    const holdBodies: HoldBodyDraw[] = [];

    if (!sprites) return { holdBodies };

    for (let i = 0; i < snapshot.visibleCount; i += 1) {
      if (snapshot.isHold[i] !== 1) continue;

      const lane = snapshot.lane[i]!;
      const alpha = snapshot.alpha[i]!;
      const centerY = snapshot.y[i]!;
      const column = columnForLane(columns, lane);
      const bodyPath = sprites.bodies[lane];
      const headPath = sprites.notes[lane];
      if (!bodyPath || bodyPath === headPath) continue;

      const layoutHold = holdNoteLayout({
        startCenterY: centerY,
        endCenterY: snapshot.holdEndCenterY[i]!,
        column,
        tailPath: sprites.tails[lane],
        spriteSizes: skin.spriteSizes,
      });
      if (layoutHold.bodyHeight <= 0) continue;

      holdBodies.push({
        spritePath: bodyPath,
        x: column.x + column.w * 0.08,
        yBottom: layoutHold.bottomCenter,
        width: column.w * 0.84,
        height: layoutHold.bodyHeight,
        alpha: alpha * 0.95,
      });
    }

    return { holdBodies };
  }, [snapshot, sprites, columns, skin.spriteSizes, frameVersion]);

  const notes = [];
  for (let i = 0; i < snapshot.visibleCount; i += 1) {
    const noteId = snapshot.noteIndex[i]!;
    const lane = snapshot.lane[i]!;
    const column = columnForLane(columns, lane);
    const alpha = snapshot.alpha[i]!;
    const isHold = snapshot.isHold[i] === 1;
    const centerY = snapshot.y[i]!;
    const tapH = column.tapHeight;
    const headTop = centerY - tapH / 2;
    const headSprite = sprites?.notes[lane];
    const bodyPath = sprites?.bodies[lane];
    const tailSprite = sprites?.tails[lane];
    const useBodySprite =
      isHold && bodyPath != null && bodyPath !== headSprite;

    if (isHold) {
      const layoutHold = holdNoteLayout({
        startCenterY: centerY,
        endCenterY: snapshot.holdEndCenterY[i]!,
        column,
        tailPath: tailSprite,
        spriteSizes: skin.spriteSizes,
      });

      if (!useBodySprite && layoutHold.bodyHeight > 0) {
        notes.push(
          <div
            key={`hold-body-${noteId}`}
            style={{
              position: "absolute",
              left: column.x + skin.notePadding,
              top: layoutHold.bodyTop,
              width: Math.max(4, column.w - skin.notePadding * 2),
              height: layoutHold.bodyHeight,
              borderRadius: skin.noteBorderRadius,
              backgroundColor: skin.laneColors[lane % skin.laneColors.length],
              opacity: alpha * 0.85,
            }}
          />,
        );
      }

      if (tailSprite && layoutHold.tailH > 0) {
        notes.push(
          <SkinSprite
            key={`hold-tail-${noteId}`}
            src={tailSprite}
            style={{
              left: column.x,
              top: layoutHold.tailTop,
              width: column.w,
              height: layoutHold.tailH,
              opacity: alpha,
            }}
          />,
        );
      }
    }

    notes.push(
      headSprite ? (
        <SkinSprite
          key={`note-${noteId}`}
          src={headSprite}
          style={{
            left: column.x,
            top: headTop,
            width: column.w,
            height: tapH,
            opacity: alpha,
          }}
        />
      ) : (
        <div
          key={`note-${noteId}`}
          style={{
            position: "absolute",
            left: column.x + skin.notePadding,
            top: headTop,
            width: Math.max(4, column.w - skin.notePadding * 2),
            height: tapH,
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
            top: receptorY,
            width: snapshot.width,
            height: snapshot.playfieldHeight - receptorY,
            backgroundColor: skin.belowReceptorBackground,
          }}
        />

        <HoldBodiesLayer
          width={snapshot.width}
          height={snapshot.playfieldHeight}
          content={holdBodiesContent}
          frameVersion={frameVersion}
        />

        {notes}

        <div
          style={{
            position: "absolute",
            left: 0,
            top: receptorY,
            width: snapshot.width,
            height: 3,
            backgroundColor: skin.judgmentLineColor,
          }}
        />

        {receptors}

        {game.judgmentEffects.getPopups(skin).map((popup) => {
          const column = columnForLane(columns, popup.lane);
          return (
            <text
              key={popup.id}
              style={{
                position: "absolute",
                left: column.x + 8,
                top: receptorY - 28,
                color: popup.color,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {popup.label}
            </text>
          );
        })}
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
