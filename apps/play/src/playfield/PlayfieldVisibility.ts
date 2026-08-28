export function findVisibleRange(
  startTimes: Float64Array,
  songTimeMs: number,
  lookAheadMs: number,
  lookBehindMs: number,
): { begin: number; end: number } {
  const minTime = songTimeMs - lookBehindMs;
  const maxTime = songTimeMs + lookAheadMs;

  let begin = 0;
  let end = startTimes.length;

  while (begin < end) {
    const mid = (begin + end) >> 1;
    if (startTimes[mid]! < minTime) {
      begin = mid + 1;
    } else {
      end = mid;
    }
  }

  const rangeStart = begin;
  end = startTimes.length;

  while (begin < end) {
    const mid = (begin + end) >> 1;
    if (startTimes[mid]! <= maxTime) {
      begin = mid + 1;
    } else {
      end = mid;
    }
  }

  return { begin: rangeStart, end: begin };
}
