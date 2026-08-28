import { useEffect, useMemo, useState } from "react";
import { render } from "@gpuix/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Stack,
  Text,
  colors,
  gpuixRenderOptions,
} from "./components/ui";
import type { SampleBeatmap } from "./game/Game";
import { createGame } from "./game/createGame";
import type { GameEnvironment } from "./game/Game";
import type { GameStateSnapshot } from "./game/GameState";

function formatBeatmap(beatmap: SampleBeatmap): string {
  const title = beatmap.title ?? "Unknown title";
  const artist = beatmap.artist ?? "Unknown artist";
  const diff = beatmap.difficultyName ?? "?";
  return `${artist} — ${title} [${diff}]`;
}

function assetBadge(beatmap: SampleBeatmap) {
  if (!beatmap.hash) {
    return <Badge variant="destructive">no hash</Badge>;
  }
  if (!beatmap.beatmapAsset) {
    return <Badge variant="secondary">unknown</Badge>;
  }
  if (beatmap.beatmapAsset.status === "available") {
    return <Badge variant="default">.osu available</Badge>;
  }
  return (
    <Badge variant="destructive">
      missing ({beatmap.beatmapAsset.reason})
    </Badge>
  );
}

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
          Shared Roxysu catalog loaded in read-only mode.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="sm">
          <HStack gap="sm">
            <Badge variant="secondary">{availability.beatmapCount} beatmaps</Badge>
            <Badge variant="secondary">
              {availability.maniaBeatmapCount} mania
            </Badge>
            <Badge variant="default">
              {availability.mania7kBeatmapCount} mania 7K
            </Badge>
          </HStack>
          <Text size="sm" muted>
            Database: {availability.dbPath}
          </Text>
          <Text size="sm" muted>
            osu!lazer data: {osuDataPath}
          </Text>
          <Text
            size="sm"
            color={osuFilesAvailable ? colors.success : colors.destructive}
          >
            {osuFilesAvailable
              ? "files/ store available"
              : "files/ store unavailable"}
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

  useEffect(() => {
    const unsubscribe = game.subscribe(setSnapshot);
    let cancelled = false;

    game
      .bootstrap()
      .then((env) => {
        if (!cancelled) {
          setEnvironment(env);
        }
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

  const selectedBeatmap = environment?.sampleBeatmaps.find(
    (beatmap) => beatmap.id === snapshot.selectedBeatmapId,
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: colors.background,
        padding: 24,
      }}
    >
      <Stack gap="lg" style={{ maxWidth: 960 }}>
        <Stack gap="xs">
          <Text size="2xl" weight="bold">
            Roxysu Play
          </Text>
          <Text size="sm" muted>
            M1 foundation — game core, Roxysu catalog, lazer asset resolver
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

        <Card>
          <CardHeader>
            <CardTitle>Game lifecycle</CardTitle>
            <CardDescription>
              Phase: {snapshot.phase}
              {selectedBeatmap ? ` — ${formatBeatmap(selectedBeatmap)}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack gap="sm">
              <Button
                variant="secondary"
                disabled={snapshot.phase !== "PLAYING"}
                onClick={() => game.pause()}
              >
                Pause
              </Button>
              <Button
                variant="secondary"
                disabled={snapshot.phase !== "PAUSED"}
                onClick={() => game.resume()}
              >
                Resume
              </Button>
              <Button
                variant="secondary"
                disabled={
                  snapshot.phase !== "PLAYING" && snapshot.phase !== "PAUSED"
                }
                onClick={() => game.finish()}
              >
                Finish
              </Button>
              <Button variant="outline" onClick={() => game.returnToSongSelect()}>
                Song select
              </Button>
            </HStack>
          </CardContent>
        </Card>

        {environment?.availability.status === "ready" ? (
          <Card>
            <CardHeader>
              <CardTitle>Sample mania 7K maps</CardTitle>
              <CardDescription>
                Select a map to exercise lifecycle transitions (playback comes in
                M2).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="sm">
                {environment.sampleBeatmaps.length === 0 ? (
                  <Text size="sm" muted>
                    No synchronized mania 7K maps found.
                  </Text>
                ) : (
                  environment.sampleBeatmaps.map((beatmap) => {
                    const selected = snapshot.selectedBeatmapId === beatmap.id;

                    return (
                      <HStack key={beatmap.id} gap="sm">
                        <Button
                          variant={selected ? "default" : "outline"}
                          onClick={() => game.selectBeatmap(beatmap.id)}
                        >
                          {formatBeatmap(beatmap)}
                        </Button>
                        {assetBadge(beatmap)}
                        <Button
                          variant="secondary"
                          disabled={!selected || snapshot.phase !== "SONG_SELECT"}
                          onClick={() => game.start()}
                        >
                          Start
                        </Button>
                      </HStack>
                    );
                  })
                )}
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </div>
  );
}

render(
  <App />,
  gpuixRenderOptions({
    title: "Roxysu Play",
    width: 1100,
    height: 820,
  }),
);
