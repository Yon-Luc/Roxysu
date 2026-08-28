import {
  Badge,
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
import type { BeatmapInsights } from "../database/types";

type BeatmapInsightsPanelProps = {
  insights: BeatmapInsights | null;
  loading?: boolean;
};

function InsightRow({ label, value }: { label: string; value: string }) {
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

export function BeatmapInsightsPanel({
  insights,
  loading = false,
}: BeatmapInsightsPanelProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roxysu insights</CardTitle>
          <CardDescription>Loading catalog metadata…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!insights) {
    return null;
  }

  const { mastery, pattern, maniaRating, danRating } = insights;
  const hasData =
    mastery != null ||
    pattern != null ||
    maniaRating != null ||
    danRating != null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roxysu insights</CardTitle>
        <CardDescription>
          {hasData
            ? "Mastery, patterns, and ratings from your local mirror"
            : "No Roxysu analytics cached for this map yet"}
        </CardDescription>
      </CardHeader>
      {hasData ? (
        <CardContent>
          <Stack gap="xs">
            {mastery ? (
              <>
                <InsightRow
                  label="Mastery"
                  value={`${mastery.level.toFixed(1)} (${mastery.playCount} plays)`}
                />
                {mastery.bestAccuracy != null ? (
                  <InsightRow
                    label="Best accuracy"
                    value={`${(mastery.bestAccuracy * 100).toFixed(2)}%`}
                  />
                ) : null}
                {mastery.bestPp != null ? (
                  <InsightRow
                    label="Best PP"
                    value={mastery.bestPp.toFixed(1)}
                  />
                ) : null}
              </>
            ) : null}

            {pattern?.dominantPattern ? (
              <HStack gap="sm">
                <InsightRow label="Pattern" value={pattern.dominantPattern} />
                {pattern.secondaryPattern ? (
                  <Badge variant="secondary">{pattern.secondaryPattern}</Badge>
                ) : null}
              </HStack>
            ) : null}

            {maniaRating?.starRating != null ? (
              <InsightRow
                label="Mania SR"
                value={`${maniaRating.starRating.toFixed(2)}★`}
              />
            ) : null}

            {maniaRating?.ppSs != null ? (
              <InsightRow label="SS PP" value={maniaRating.ppSs.toFixed(0)} />
            ) : null}

            {danRating?.estDiff ? (
              <InsightRow label="Sunny dan" value={danRating.estDiff} />
            ) : null}
          </Stack>
        </CardContent>
      ) : (
        <CardContent>
          <Text size="sm" muted color={colors.mutedForeground}>
            Run Roxysu analytics jobs to populate mastery, pattern analysis, and
            mania ratings.
          </Text>
        </CardContent>
      )}
    </Card>
  );
}
