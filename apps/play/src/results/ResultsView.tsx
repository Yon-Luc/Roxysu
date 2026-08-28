import { useMemo } from "react";
import {
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
} from "../components/ui";
import type { Game } from "../game/Game";
import type { PlayResult } from "../results/PlayResult";
import type { PlaySessionSummary } from "../database/PlaySessionRepository";
import type { ScoreSummary } from "../database/types";
import { BeatmapInsightsPanel } from "../songselect/BeatmapInsightsPanel";

type ResultsViewProps = {
  game: Game;
  result: PlayResult;
  onRetry: () => void;
  onSongSelect: () => void;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap="sm" style={{ justifyContent: "space-between" }}>
      <Text size="sm" muted>
        {label}
      </Text>
      <Text size="sm" weight="semibold">
        {value}
      </Text>
    </HStack>
  );
}

function formatScoreRow(score: ScoreSummary): string {
  const date = score.playedAt.toLocaleDateString();
  const accuracy = `${(score.accuracy * 100).toFixed(2)}%`;
  return `${date} · ${accuracy} · ${score.totalScore.toLocaleString()} · ${score.maxCombo}x`;
}

function formatPlaySessionRow(session: PlaySessionSummary): string {
  const date = session.playedAt.toLocaleDateString();
  const accuracy = `${(session.accuracy * 100).toFixed(2)}%`;
  return `${date} · ${accuracy} · ${session.totalScore.toLocaleString()} · ${session.maxCombo}x · Play`;
}

export function ResultsView({
  game,
  result,
  onRetry,
  onSongSelect,
}: ResultsViewProps) {
  const { counts } = result;
  const insights = useMemo(
    () => game.getBeatmapInsights(result.chartId),
    [game, result.chartId],
  );
  const scoreHistory = useMemo(
    () => game.getScoreHistory(result.chartId, 8),
    [game, result.chartId],
  );
  const playSessions = useMemo(
    () => game.getPlaySessions(result.chartId, 8),
    [game, result.chartId],
  );

  return (
    <Stack gap="md">
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>
            {result.artist} — {result.title} [{result.difficultyName}]
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            <Text size="2xl" weight="bold" color={colors.primary}>
              {(result.accuracy * 100).toFixed(2)}%
            </Text>

            <Stack gap="xs">
              <StatRow label="Score" value={result.score.toLocaleString()} />
              <StatRow label="Max combo" value={`${result.maxCombo}x`} />
              <StatRow label="Perfect" value={String(counts.perfect)} />
              <StatRow label="Great" value={String(counts.great)} />
              <StatRow label="Good" value={String(counts.good)} />
              <StatRow label="Ok" value={String(counts.ok)} />
              <StatRow label="Meh" value={String(counts.meh)} />
              <StatRow label="Miss" value={String(counts.miss)} />
            </Stack>

            <HStack gap="sm">
              <Button variant="default" onClick={onRetry}>
                Play again
              </Button>
              <Button variant="outline" onClick={onSongSelect}>
                Song select
              </Button>
            </HStack>
          </Stack>
        </CardContent>
      </Card>

      <BeatmapInsightsPanel insights={insights} />

      <Card>
        <CardHeader>
          <CardTitle>Play sessions</CardTitle>
          <CardDescription>
            Local results recorded by Roxysu Play
          </CardDescription>
        </CardHeader>
        <CardContent>
          {playSessions.length === 0 ? (
            <Text size="sm" muted>
              No Play sessions saved for this map yet.
            </Text>
          ) : (
            <Stack gap="xs">
              {playSessions.map((session) => (
                <Text key={session.id} size="sm">
                  {formatPlaySessionRow(session)}
                </Text>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Imported scores</CardTitle>
          <CardDescription>
            Recent plays synced from osu!lazer via Roxysu
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scoreHistory.length === 0 ? (
            <Text size="sm" muted>
              No prior scores recorded for this map.
            </Text>
          ) : (
            <Stack gap="xs">
              {scoreHistory.map((score) => (
                <Text key={score.id} size="sm">
                  {formatScoreRow(score)}
                </Text>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
