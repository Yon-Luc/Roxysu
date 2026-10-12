export const FINGERPRINT_MS = 5_000;

export type TransferFinger = {
  onlineId: number;
  legacyOnlineId: number;
  beatmapOnlineId: number;
  beatmapMd5: string | null;
  beatmapHash: string | null;
  ruleset: string;
  playedAtMs: number;
  totalScore: number;
  legacyTotalScore: number | null;
};

export type TransferBeatmap = {
  onlineId: number;
  md5Hash: string | null;
  hash: string | null;
};

export type TransferClass = "already" | "add" | "add-current-version" | "skipped";

export type TransferIndex = {
  onlineIds: Set<number>;
  legacyIds: Set<number>;
  buckets: Map<string, TransferFinger[]>;
  beatmapsByOnlineId: Map<number, TransferBeatmap[]>;
  beatmapsByMd5: Map<string, TransferBeatmap>;
  beatmapsByHash: Map<string, TransferBeatmap>;
};

function norm(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function bucketOf(ms: number): number {
  return Math.floor(ms / FINGERPRINT_MS);
}

function bucketKey(ruleset: string, bucket: number): string {
  return `${ruleset}\0${bucket}`;
}

function totalsOverlap(a: TransferFinger, b: TransferFinger): boolean {
  const left = [a.totalScore];
  if (a.legacyTotalScore != null) left.push(a.legacyTotalScore);
  const right = new Set<number>([b.totalScore]);
  if (b.legacyTotalScore != null) right.add(b.legacyTotalScore);
  return left.some((n) => right.has(n));
}

function sameBeatmap(a: TransferFinger, b: TransferFinger): boolean {
  if (a.beatmapOnlineId > 0 && a.beatmapOnlineId === b.beatmapOnlineId) return true;
  const md5 = norm(a.beatmapMd5);
  if (md5 && md5 === norm(b.beatmapMd5)) return true;
  const hash = norm(a.beatmapHash);
  return hash.length > 0 && hash === norm(b.beatmapHash);
}

export function sameScore(a: TransferFinger, b: TransferFinger): boolean {
  if (!a.ruleset || a.ruleset !== b.ruleset) return false;
  if (Math.abs(a.playedAtMs - b.playedAtMs) > FINGERPRINT_MS) return false;
  if (!totalsOverlap(a, b)) return false;
  return sameBeatmap(a, b);
}

export function buildTransferIndex(
  scores: TransferFinger[],
  beatmaps: TransferBeatmap[],
): TransferIndex {
  const onlineIds = new Set<number>();
  const legacyIds = new Set<number>();
  const buckets = new Map<string, TransferFinger[]>();
  for (const score of scores) {
    if (score.onlineId > 0) onlineIds.add(score.onlineId);
    if (score.legacyOnlineId > 0) legacyIds.add(score.legacyOnlineId);
    if (!score.ruleset) continue;
    const key = bucketKey(score.ruleset, bucketOf(score.playedAtMs));
    const list = buckets.get(key);
    if (list) list.push(score);
    else buckets.set(key, [score]);
  }

  const beatmapsByOnlineId = new Map<number, TransferBeatmap[]>();
  const beatmapsByMd5 = new Map<string, TransferBeatmap>();
  const beatmapsByHash = new Map<string, TransferBeatmap>();
  for (const map of beatmaps) {
    if (!map.hash) continue;
    if (map.onlineId > 0) {
      const list = beatmapsByOnlineId.get(map.onlineId);
      if (list) list.push(map);
      else beatmapsByOnlineId.set(map.onlineId, [map]);
    }
    const md5 = norm(map.md5Hash);
    if (md5 && !beatmapsByMd5.has(md5)) beatmapsByMd5.set(md5, map);
    const hash = norm(map.hash);
    if (hash && !beatmapsByHash.has(hash)) beatmapsByHash.set(hash, map);
  }

  return {
    onlineIds,
    legacyIds,
    buckets,
    beatmapsByOnlineId,
    beatmapsByMd5,
    beatmapsByHash,
  };
}

function fingerprintHit(score: TransferFinger, index: TransferIndex): boolean {
  if (!score.ruleset) return false;
  const bucket = bucketOf(score.playedAtMs);
  for (const delta of [-1, 0, 1]) {
    const list = index.buckets.get(bucketKey(score.ruleset, bucket + delta));
    if (!list) continue;
    for (const other of list) {
      if (sameScore(score, other)) return true;
    }
  }
  return false;
}

export function classifyTransferScore(
  score: TransferFinger,
  index: TransferIndex,
): TransferClass {
  if (score.onlineId > 0 && index.onlineIds.has(score.onlineId)) return "already";
  if (score.legacyOnlineId > 0 && index.legacyIds.has(score.legacyOnlineId)) {
    return "already";
  }
  if (fingerprintHit(score, index)) return "already";

  if (score.beatmapOnlineId > 0) {
    const maps = index.beatmapsByOnlineId.get(score.beatmapOnlineId) ?? [];
    if (maps.length === 0) return "skipped";
    const md5 = norm(score.beatmapMd5);
    if (md5 && maps.some((map) => norm(map.md5Hash) === md5)) return "add";
    return "add-current-version";
  }

  const md5 = norm(score.beatmapMd5);
  if (md5 && index.beatmapsByMd5.has(md5)) return "add";
  const hash = norm(score.beatmapHash);
  if (hash && index.beatmapsByHash.has(hash)) return "add";
  return "skipped";
}
