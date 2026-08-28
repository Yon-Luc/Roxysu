import { useEffect, useMemo, useState } from "react";
import path from "node:path";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  colors,
} from "../components/ui";
import type { Game } from "../game/Game";
import { pickSkinArchivePathAsync } from "../integrations/native-file-dialog";
import { DEFAULT_PLAYFIELD_SKIN } from "../skin/defaultSkin";
import { OSU_MANIA_HEIGHT } from "../integrations/osu-skin-ini";
import {
  DEFAULT_LANE_KEYS,
  formatKeyLabel,
  HIT_POSITION_DEFAULT,
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  normalizeLaneKey,
  type PlaySettings,
} from "../settings/PlaySettings";

type PlaySettingsViewProps = {
  game: Game;
  settings: PlaySettings;
};

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Stack gap="xs">
      <Text size="sm" weight="semibold">
        {label}
      </Text>
      <Input
        value={String(value)}
        onValueChange={(next) => {
          const parsed = Number(next);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </Stack>
  );
}

const LANE_LABELS = ["1", "2", "3", "4", "5", "6", "7"];
const DEFAULT_SKIN_VALUE = "__default__";

export function PlaySettingsView({ game, settings }: PlaySettingsViewProps) {
  const installedSkins = useMemo(() => game.listSkins(), [game]);
  const skinNotice = game.getSkinNotice();
  const [skinRevision, setSkinRevision] = useState(0);
  void skinRevision;
  const activeSkin = game.getPlayfieldSkin();
  const [customSkinPath, setCustomSkinPath] = useState(settings.skinPath ?? "");
  const [skinBrowseError, setSkinBrowseError] = useState<string | null>(null);
  const [browsingSkin, setBrowsingSkin] = useState(false);

  useEffect(() => {
    return game.subscribe(() => {
      setSkinRevision((value) => value + 1);
    });
  }, [game]);

  useEffect(() => {
    setCustomSkinPath(settings.skinPath ?? "");
  }, [settings.skinPath]);

  const importedSkin =
    settings.skinPath &&
    !installedSkins.some(
      (skin) => path.resolve(skin.path) === path.resolve(settings.skinPath!),
    );

  const selectedSkinValue = settings.skinPath ?? DEFAULT_SKIN_VALUE;

  const browseForSkin = () => {
    if (browsingSkin) return;

    setSkinBrowseError(null);
    setBrowsingSkin(true);
    void pickSkinArchivePathAsync().then(({ path, error }) => {
      setBrowsingSkin(false);
      if (error) {
        setSkinBrowseError(error);
        return;
      }
      if (!path) return;
      setCustomSkinPath(path);
      game.setSkin(path);
    });
  };

  const updateLaneKey = (lane: number, raw: string) => {
    const next = [...settings.laneKeys];
    next[lane] = normalizeLaneKey(raw);
    game.updateSettings({ laneKeys: next });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Stored in the shared Roxysu local mirror</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="md">
          <Stack gap="xs">
            <Text size="sm" weight="semibold">
              Skin
            </Text>
            <Select
              value={selectedSkinValue}
              onValueChange={(value) =>
                game.setSkin(value === DEFAULT_SKIN_VALUE ? null : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a skin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_SKIN_VALUE}>
                  {DEFAULT_PLAYFIELD_SKIN.name}
                </SelectItem>
                {installedSkins.map((skin) => (
                  <SelectItem key={skin.id} value={skin.path}>
                    {skin.name}
                  </SelectItem>
                ))}
                {importedSkin && settings.skinPath ? (
                  <SelectItem value={settings.skinPath}>
                    {activeSkin.name} (imported)
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Text size="sm" muted>
              Active: {activeSkin.name}
              {activeSkin.sourcePath ? ` · ${activeSkin.sourcePath}` : ""}
            </Text>
            {skinNotice ? (
              <Text size="sm" color={colors.destructive}>
                {skinNotice}
              </Text>
            ) : null}
            <Text size="sm" muted>
              Drag-and-drop is not available in the GPUIX window yet — browse for a
              .osk or paste a skin folder path.
            </Text>
            <Stack gap="sm">
              <Input
                placeholder="Custom skin folder or .osk path"
                value={customSkinPath}
                onValueChange={setCustomSkinPath}
              />
              <HStack gap="sm">
                <Button
                  variant="outline"
                  loading={browsingSkin}
                  onClick={browseForSkin}
                >
                  Browse .osk
                </Button>
                <Button
                  variant="outline"
                  onClick={() => game.setSkin(customSkinPath.trim() || null)}
                >
                  Apply
                </Button>
              </HStack>
            </Stack>
            {skinBrowseError ? (
              <Text size="sm" color={colors.destructive}>
                {skinBrowseError}
              </Text>
            ) : null}
          </Stack>

          <Stack gap="xs">
            <Text size="sm" weight="semibold">
              Playfield layout
            </Text>
            <Select
              value={settings.playfieldAlign}
              onValueChange={(value) =>
                game.updateSettings({
                  playfieldAlign: value === "left" ? "left" : "center",
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Alignment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="center">Center columns</SelectItem>
                <SelectItem value="left">Left (skin.ini ColumnStart)</SelectItem>
              </SelectContent>
            </Select>
            <Text size="sm" muted>
              Hit position:{" "}
              {settings.hitPosition == null
                ? activeSkin.maniaLayout
                  ? `skin.ini (${Math.round((activeSkin.maniaLayout.hitPositionPx / OSU_MANIA_HEIGHT) * 100)}%)`
                  : `default (${Math.round(HIT_POSITION_DEFAULT * 100)}%)`
                : `${Math.round(settings.hitPosition * 100)}%`}
            </Text>
            <HStack gap="sm">
              <Button
                variant="outline"
                onClick={() => game.updateSettings({ hitPosition: null })}
              >
                Use skin.ini
              </Button>
              <Input
                value={
                  settings.hitPosition == null
                    ? ""
                    : String(Math.round(settings.hitPosition * 100))
                }
                placeholder={`${Math.round(HIT_POSITION_DEFAULT * 100)}`}
                onValueChange={(next) => {
                  if (!next.trim()) {
                    game.updateSettings({ hitPosition: null });
                    return;
                  }
                  const parsed = Number(next);
                  if (!Number.isFinite(parsed)) return;
                  game.updateSettings({
                    hitPosition: Math.max(
                      HIT_POSITION_MIN,
                      Math.min(HIT_POSITION_MAX, parsed / 100),
                    ),
                  });
                }}
              />
            </HStack>
            <Text size="sm" muted>
              Percent of playfield height from the top to the judgment line.
            </Text>
          </Stack>

          <NumberField
            label="Scroll speed (px/s)"
            value={settings.scrollSpeed}
            onChange={(scrollSpeed) => game.updateSettings({ scrollSpeed })}
          />
          <NumberField
            label="Master volume (0–1)"
            value={settings.masterVolume}
            onChange={(masterVolume) => game.updateSettings({ masterVolume })}
          />
          <NumberField
            label="Countdown (seconds)"
            value={settings.countdownSeconds}
            onChange={(countdownSeconds) =>
              game.updateSettings({ countdownSeconds })
            }
          />
          <NumberField
            label="User offset (ms)"
            value={settings.userOffsetMs}
            onChange={(userOffsetMs) => game.updateSettings({ userOffsetMs })}
          />

          <Stack gap="xs">
            <Text size="sm" weight="semibold">
              7K key bindings
            </Text>
            <HStack gap="sm">
              {settings.laneKeys.map((key, lane) => (
                <Stack key={lane} gap="xs">
                  <Text size="sm" muted>
                    {LANE_LABELS[lane]}
                  </Text>
                  <Input
                    value={formatKeyLabel(key)}
                    onValueChange={(value) => updateLaneKey(lane, value)}
                  />
                </Stack>
              ))}
            </HStack>
          </Stack>

          <HStack gap="sm">
            <Button
              variant="outline"
              onClick={() => game.updateSettings({ scrollSpeed: 400 })}
            >
              Reset scroll
            </Button>
            <Button
              variant="outline"
              onClick={() => game.updateSettings({ laneKeys: DEFAULT_LANE_KEYS })}
            >
              Reset keys
            </Button>
            <Button variant="outline" onClick={() => game.resetSettings()}>
              Reset all
            </Button>
          </HStack>
        </Stack>
      </CardContent>
    </Card>
  );
}
