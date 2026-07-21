import type { RegressionCandidate, ReferenceBucketKey } from "./types";

type CandidateRow = Omit<RegressionCandidate, "bucket"> & {
  bucket?: ReferenceBucketKey;
};

export function pickRegressionCandidates(
  rows: CandidateRow[],
  targetCount = 32,
): RegressionCandidate[] {
  const byBucket = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const bucket = row.bucket ?? {
      starBand: `${Math.floor(row.starRating * 2) / 2}-${Math.floor(row.starRating * 2) / 2 + 0.5}`,
      bpmBand: `${Math.floor(row.bpm / 20) * 20}-${Math.floor(row.bpm / 20) * 20 + 19}`,
    };
    const key = `${bucket.starBand}__${bucket.bpmBand}`;
    const existing = byBucket.get(key);
    if (existing) existing.push({ ...row, bucket });
    else byBucket.set(key, [{ ...row, bucket }]);
  }

  const buckets = [...byBucket.entries()]
    .map(([key, items]) => ({ key, items: [...items].sort((a, b) => a.starRating - b.starRating) }))
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));

  const picked: RegressionCandidate[] = [];
  let cursor = 0;
  while (picked.length < targetCount && buckets.some((bucket) => bucket.items.length > cursor)) {
    for (const bucket of buckets) {
      const item = bucket.items[cursor];
      if (!item || !item.bucket) continue;
      picked.push({
        beatmapId: item.beatmapId,
        title: item.title,
        artist: item.artist,
        difficultyName: item.difficultyName,
        bpm: item.bpm,
        starRating: item.starRating,
        mapperUsername: item.mapperUsername,
        audioFileHash: item.audioFileHash,
        bucket: item.bucket,
      });
      if (picked.length >= targetCount) break;
    }
    cursor += 1;
  }

  return picked;
}
