import { useEffect, useMemo, useState } from "react";
import { render } from "@gpuix/react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  ScrollArea,
  Stack,
  Text,
  colors,
  gpuixRenderOptions,
} from "./components/ui";
import { createGame } from "./game/createGame";
import type { GameEnvironment } from "./game/Game";
import type { GameStateSnapshot } from "./game/GameState";
import { PlayView } from "./play/PlayView";
import { CountdownView } from "./play/CountdownView";
import { ResultsView } from "./results/ResultsView";
import { PlaySettingsView } from "./settings/PlaySettingsView";
import { SongSelectView } from "./songselect/SongSelectView";
import type { PlaySettings } from "./settings/PlaySettings";

function AvailabilityCard({ environment }: { environment: GameEnvironment }) {
  const { availability, osuDataPath, osuFilesAvailable } = environment;

  if (availability.status === "unavailable") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roxysu required</CardTitle>
          <CardDescription>{availability.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="sm">
            <Text size="sm" muted>
              Database path: {availability.dbPath}
            </Text>
            <Text size="sm" muted>
              Reason: {availability.reason}
            </Text>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (availability.status === "empty") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No beatmaps synchronized</CardTitle>
          <CardDescription>{availability.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Text size="sm" muted>
            Database path: {availability.dbPath}
          </Text>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Library ready</CardTitle>
        <CardDescription>
          Shared Roxysu catalog · read-only
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="sm">
          <HStack gap="sm">
            <Badge variant="secondary">{availability.beatmapCount} beatmaps</Badge>
            <Badge variant="default">
              {availability.mania7kBeatmapCount} mania 7K
            </Badge>
          </HStack>
          <Text size="sm" muted>
            osu!lazer: {osuDataPath}
          </Text>
          <Text
            size="sm"
            color={osuFilesAvailable ? colors.success : colors.destructive}
          >
            {osuFilesAvailable ? "files/ available" : "files/ unavailable"}
          </Text>
          <Text size="sm" muted>
            Audio:{" "}
            {environment.audioBackend === "native"
              ? "native (miniaudio)"
              : "timeline only (no sound)"}
          </Text>
        </Stack>
      </CardContent>
    </Card>
  );
}

function App() {
  const game = useMemo(() => createGame(), []);
  const [environment, setEnvironment] = useState<GameEnvironment | null>(null);
  const [snapshot, setSnapshot] = useState<GameStateSnapshot>(() =>
    game.getSnapshot(),
  );
  const [bootError, setBootError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [playSettings, setPlaySettings] = useState<PlaySettings>(() =>
    game.getSettings(),
  );

  useEffect(() => {
    return game.settings.subscribe(setPlaySettings);
  }, [game]);

  useEffect(() => {
    const unsubscribe = game.subscribe(setSnapshot);
    let cancelled = false;

    game
      .bootstrap()
      .then((env) => {
        if (!cancelled) setEnvironment(env);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBootError(
            error instanceof Error ? error.message : "Failed to bootstrap game",
          );
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
      game.dispose();
    };
  }, [game]);

  const playing =
    snapshot.phase === "PLAYING" || snapshot.phase === "PAUSED";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: colors.background,
      }}
    >
      <ScrollArea
        style={{
          flexGrow: 1,
          borderWidth: 0,
          backgroundColor: colors.background,
        }}
      >
        <Stack gap="lg" style={{ maxWidth: 960, alignItems: "stretch", padding: 24 }}>
          <Stack gap="xs">
            <Text size="2xl" weight="bold">
              Roxysu Play
            </Text>
            <Text size="sm" muted>
              M6 — song sort, default skin, persisted settings
            </Text>
          </Stack>

          {bootError ? (
            <Card>
              <CardHeader>
                <CardTitle>Bootstrap failed</CardTitle>
                <CardDescription>{bootError}</CardDescription>
              </CardHeader>
            </Card>
          ) : environment ? (
            <AvailabilityCard environment={environment} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Booting</CardTitle>
                <CardDescription>Opening Roxysu database…</CardDescription>
              </CardHeader>
            </Card>
          )}

          {snapshot.error ? (
            <Card>
              <CardHeader>
                <CardTitle>Error</CardTitle>
                <CardDescription>{snapshot.error}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {snapshot.phase === "SONG_SELECT" &&
          environment?.availability.status === "ready" ? (
            <>
              <PlaySettingsView game={game} settings={playSettings} />
              <SongSelectView
                game={game}
                selectedBeatmapId={snapshot.selectedBeatmapId}
                starting={starting}
                onStart={() => {
                  setStarting(true);
                  void game.start().finally(() => setStarting(false));
                }}
              />
            </>
          ) : null}

          {snapshot.phase === "COUNTDOWN" ? (
            <CountdownView
              remainingMs={snapshot.countdownRemainingMs ?? 0}
              title={snapshot.loadedBeatmapTitle}
            />
          ) : null}

          {playing ? (
            <PlayView
              game={game}
              frameVersion={snapshot.frameVersion}
              songTimeMs={snapshot.songTimeMs}
              combo={snapshot.combo}
              score={snapshot.score}
              accuracy={snapshot.accuracy}
              phase={snapshot.phase === "PAUSED" ? "PAUSED" : "PLAYING"}
            />
          ) : null}

          {snapshot.phase === "RESULTS" && snapshot.playResult ? (
            <ResultsView
              game={game}
              result={snapshot.playResult}
              onRetry={() => {
                setStarting(true);
                void game.start().finally(() => setStarting(false));
              }}
              onSongSelect={() => game.returnToSongSelect()}
            />
          ) : null}
        </Stack>
      </ScrollArea>
    </div>
  );
}

render(
  <App />,
  gpuixRenderOptions({
    title: "Roxysu Play",
    width: 1100,
    height: 900,
  }),
);
