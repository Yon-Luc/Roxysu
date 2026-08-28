export type SongSortBy =
  | "lastPlayed"
  | "stars"
  | "title"
  | "artist"
  | "bpm"
  | "length";

export type SongSortDir = "asc" | "desc";

export type SongSort = {
  by: SongSortBy;
  dir: SongSortDir;
};

export const DEFAULT_SONG_SORT: SongSort = {
  by: "lastPlayed",
  dir: "desc",
};

export const SONG_SORT_OPTIONS: ReadonlyArray<{
  by: SongSortBy;
  label: string;
}> = [
  { by: "lastPlayed", label: "Last played" },
  { by: "stars", label: "Star rating" },
  { by: "title", label: "Title" },
  { by: "artist", label: "Artist" },
  { by: "bpm", label: "BPM" },
  { by: "length", label: "Length" },
];

export function formatSongSortLabel(sort: SongSort): string {
  const option = SONG_SORT_OPTIONS.find((item) => item.by === sort.by);
  const base = option?.label ?? sort.by;
  return sort.dir === "asc" ? `${base} ↑` : `${base} ↓`;
}
