import { useMemo } from "react";
import type { EventPayload } from "@gpuix/react";
import {
  Button,
  HStack,
  colors,
} from "../components/ui";
import type { Game } from "../game/Game";
import type { PlayfieldColumnSnapshot } from "../playfield/PlayfieldTypes";
import { toSkinAssetUrl } from "../skin/skinFileLookup";
import { buildPlayfieldSkinLayout } from "../skin/skinLayout";
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
  void frameVersion;
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
            height: layout.receptorY,
            backgroundColor:
              lane % 2 === 0
                ? skin.laneBackgroundEven
                : skin.laneBackgroundOdd,
          }}
        />
      )),
    [
      layout.columns,
      layout.receptorY,
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
            height: layout.receptorY,
            backgroundColor: colors.border,
          }}
        />
      )),
    [layout.lines, layout.receptorY],
  );

  const receptors = useMemo(
    () =>
      layout.columns.map((column, lane) => {
        const keySprite = sprites?.keysUp[lane];
        const tapH = column.tapHeight;
        const top = layout.receptorY - tapH;

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
              top: layout.receptorY + 10,
              width: Math.max(8, column.w - 14),
              height: skin.receptorHeight,
              borderRadius: 5,
              backgroundColor: skin.receptorFill,
            }}
          />
        );
      }),
    [layout.columns, layout.receptorY, skin.receptorFill, skin.receptorHeight, sprites],
  );

  const notes = [];
  for (let i = 0; i < snapshot.visibleCount; i += 1) {
    const lane = snapshot.lane[i]!;
    const column = columnForLane(layout.columns, lane);
    const y = snapshot.y[i]!;
    const totalHeight = snapshot.noteHeight[i]!;
    const alpha = snapshot.alpha[i]!;
    const isHold = snapshot.isHold[i] === 1;
    const tapH = column.tapHeight;
    const headSprite = sprites?.notes[lane];
    const bodySprite = sprites?.bodies[lane];

    if (isHold && totalHeight > tapH) {
      const bodyHeight = totalHeight - tapH;
      if (bodySprite) {
        notes.push(
          <SkinSprite
            key={`hold-body-${i}-${Math.round(y)}`}
            src={bodySprite}
            style={{
              left: column.x,
              top: y + tapH,
              width: column.w,
              height: bodyHeight,
              opacity: alpha,
            }}
          />,
        );
      } else {
        notes.push(
          <div
            key={`hold-body-${i}-${Math.round(y)}`}
            style={{
              position: "absolute",
              left: column.x + skin.notePadding,
              top: y + tapH,
              width: Math.max(4, column.w - skin.notePadding * 2),
              height: bodyHeight,
              borderRadius: skin.noteBorderRadius,
              backgroundColor: skin.laneColors[lane % skin.laneColors.length],
              opacity: alpha * 0.85,
            }}
          />,
        );
      }
    }

    notes.push(
      headSprite ? (
        <SkinSprite
          key={`note-${i}-${Math.round(y)}`}
          src={headSprite}
          style={{
            left: column.x,
            top: y,
            width: column.w,
            height: Math.min(tapH, totalHeight),
            opacity: alpha,
          }}
        />
      ) : (
        <div
          key={`note-${i}-${Math.round(y)}`}
          style={{
            position: "absolute",
            left: column.x + skin.notePadding,
            top: y,
            width: Math.max(4, column.w - skin.notePadding * 2),
            height: Math.min(tapH, totalHeight),
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
            top: layout.receptorY,
            width: snapshot.width,
            height: snapshot.playfieldHeight - layout.receptorY,
            backgroundColor: skin.belowReceptorBackground,
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 0,
            top: layout.receptorY,
            width: snapshot.width,
            height: 3,
            backgroundColor: skin.judgmentLineColor,
          }}
        />

        {notes}
        {receptors}

        {game.judgmentEffects.getPopups(skin).map((popup) => {
          const column = columnForLane(layout.columns, popup.lane);
          return (
            <text
              key={popup.id}
              style={{
                position: "absolute",
                left: column.x + 8,
                top: layout.receptorY - 28,
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
