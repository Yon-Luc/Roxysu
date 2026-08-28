import { useEffect, useMemo, useState } from "react";
import {
  Badge,
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
import type { CollectionSummary } from "../database/types";
import type { Game } from "../game/Game";
import type { SongSelectEntry } from "../songselect/SongSelect";
import { BeatmapInsightsPanel } from "../songselect/BeatmapInsightsPanel";

function formatEntry(entry: SongSelectEntry): string {
  const artist = entry.artist ?? "Unknown artist";
  const title = entry.title ?? "Unknown title";
  const diff = entry.difficultyName ?? "?";
  const stars = entry.starRating.toFixed(2);
  return `${artist} — ${title} [${diff}] ★${stars}`;
}

function collectionKey(collection: CollectionSummary): string {
  return `${collection.kind}:${collection.id}`;
}

function findCollection(
  collections: CollectionSummary[],
  key: string | null,
): CollectionSummary | null {
  if (!key) return null;
  return collections.find((item) => collectionKey(item) === key) ?? null;
}

type SongSelectViewProps = {
  game: Game;
  selectedBeatmapId: string | null;
  onStart: () => void;
  starting: boolean;
};

export function SongSelectView({
  game,
  selectedBeatmapId,
  onStart,
  starting,
}: SongSelectViewProps) {
  const collections = useMemo(() => game.listCollections(), [game]);
  const [query, setQuery] = useState("");
  const [collectionKeyValue, setCollectionKeyValue] = useState<string | null>(
    null,
  );
  const selectedCollection = findCollection(collections, collectionKeyValue);
  const [page, setPage] = useState(() =>
    game.searchSongSelect({ collection: selectedCollection }),
  );
  const [insights, setInsights] = useState(() =>
    selectedBeatmapId ? game.getBeatmapInsights(selectedBeatmapId) : null,
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(
        game.searchSongSelect({
          query,
          collection: selectedCollection,
        }),
      );
    }, 200);
    return () => clearTimeout(handle);
  }, [game, query, selectedCollection]);

  useEffect(() => {
    if (!selectedBeatmapId) {
      setInsights(null);
      return;
    }
    setInsights(game.getBeatmapInsights(selectedBeatmapId));
  }, [game, selectedBeatmapId]);

  return (
    <Stack gap="md">
      <Card>
        <CardHeader>
          <CardTitle>Song select</CardTitle>
          <CardDescription>
            {page.total} mania 7K maps
            {page.collectionFilterActive ? " in collection" : " in Roxysu"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            <Input
              placeholder="Search title, artist, difficulty…"
              value={query}
              onValueChange={setQuery}
            />

            <Stack gap="xs">
              <Text size="sm" weight="semibold">
                Collection
              </Text>
              <Select
                value={collectionKeyValue ?? "all"}
                onValueChange={(value) =>
                  setCollectionKeyValue(value === "all" ? null : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All maps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All maps</SelectItem>
                  {collections.map((collection) => (
                    <SelectItem
                      key={collectionKey(collection)}
                      value={collectionKey(collection)}
                    >
                      {collection.kind === "realm" ? "Realm" : "Smart"} ·{" "}
                      {collection.name}
                      {collection.mapCount != null
                        ? ` (${collection.mapCount})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCollection &&
              !game.getCatalog().canFilterCollection(selectedCollection) ? (
                <Text size="sm" color={colors.mutedForeground}>
                  Smart collections cannot be filtered in Play yet — browse all
                  maps or pick a Realm collection.
                </Text>
              ) : null}
            </Stack>

            <Stack gap="sm">
              {page.entries.length === 0 ? (
                <Text size="sm" muted>
                  No maps match your search.
                </Text>
              ) : (
                page.entries.map((entry) => {
                  const selected = selectedBeatmapId === entry.id;
                  return (
                    <HStack key={entry.id} gap="sm">
                      <Button
                        variant={selected ? "default" : "outline"}
                        onClick={() => game.selectBeatmap(entry.id)}
                      >
                        {formatEntry(entry)}
                      </Button>
                      <Badge
                        variant={
                          entry.beatmapAvailable ? "default" : "destructive"
                        }
                      >
                        {entry.beatmapAvailable ? ".osu ok" : "missing"}
                      </Badge>
                    </HStack>
                  );
                })
              )}
            </Stack>

            <HStack gap="sm">
              <Button
                variant="outline"
                disabled={page.offset === 0}
                onClick={() =>
                  setPage(
                    game.searchSongSelect({
                      query,
                      collection: selectedCollection,
                      offset: Math.max(0, page.offset - page.limit),
                    }),
                  )
                }
              >
                Previous
              </Button>
              <Text size="sm" muted>
                {page.offset + 1}–
                {Math.min(page.offset + page.limit, page.total)} of {page.total}
              </Text>
              <Button
                variant="outline"
                disabled={page.offset + page.limit >= page.total}
                onClick={() =>
                  setPage(
                    game.searchSongSelect({
                      query,
                      collection: selectedCollection,
                      offset: page.offset + page.limit,
                    }),
                  )
                }
              >
                Next
              </Button>
              <Button
                variant="default"
                disabled={!selectedBeatmapId || starting}
                onClick={onStart}
              >
                {starting ? "Loading…" : "Start"}
              </Button>
            </HStack>
          </Stack>
        </CardContent>
      </Card>

      <BeatmapInsightsPanel insights={insights} />
    </Stack>
  );
}
