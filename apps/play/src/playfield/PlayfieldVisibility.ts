export function findFirstIndexAtLeast(
  values: Float64Array,
  threshold: number,
): number {
  let begin = 0;
  let end = values.length;

  while (begin < end) {
    const mid = (begin + end) >> 1;
    if (values[mid]! < threshold) {
      begin = mid + 1;
    } else {
      end = mid;
    }
  }

  return begin;
}

export function findFirstIndexGreaterThan(
  values: Float64Array,
  threshold: number,
): number {
  let begin = 0;
  let end = values.length;

  while (begin < end) {
    const mid = (begin + end) >> 1;
    if (values[mid]! <= threshold) {
      begin = mid + 1;
    } else {
      end = mid;
    }
  }

  return begin;
}

export function findVisibleNoteRange(
  startTimes: Float64Array,
  endTimes: Float64Array,
  songTimeMs: number,
  lookAheadMs: number,
  lookBehindMs: number,
): { begin: number; end: number } {
  const minEndMs = songTimeMs - lookBehindMs;
  const maxStartMs = songTimeMs + lookAheadMs;

  const begin = findFirstIndexAtLeast(endTimes, minEndMs);
  const end = findFirstIndexGreaterThan(startTimes, maxStartMs);

  return { begin, end };
}
