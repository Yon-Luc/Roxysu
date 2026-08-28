import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  Stack,
  Text,
} from "../components/ui";
import type { Game } from "../game/Game";
import {
  DEFAULT_LANE_KEYS,
  formatKeyLabel,
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

export function PlaySettingsView({ game, settings }: PlaySettingsViewProps) {
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
