/**
 * Outbound osu!api budget. Distinct from the inbound `allowRateLimit` helper:
 * this one is seeded from the usage ledger so a restart cannot spend another minute.
 */

export const OSU_MAX_PER_MINUTE = 50;
export const OSU_MAX_IN_FLIGHT = 4;

export type OsuBudgetSnapshot = {
  callsThisMinute: number;
  limitPerMinute: number;
  inFlight: number;
  maxInFlight: number;
  parkedUntil: number | null;
  cacheHitsThisMinute: number;
};

type Clock = () => number;

const hits: number[] = [];
let inFlight = 0;
let parkedUntil = 0;
let seeded = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resetOsuBudgetForTests(): void {
  hits.length = 0;
  inFlight = 0;
  parkedUntil = 0;
  seeded = true;
}

export function seedOsuBudget(callsAlready: number, parkedUntilMs: number | null, now = Date.now()): void {
  if (seeded) return;
  seeded = true;
  const stamp = now - 1;
  const n = Math.max(0, Math.min(OSU_MAX_PER_MINUTE, callsAlready));
  for (let i = 0; i < n; i++) hits.push(stamp);
  if (parkedUntilMs != null && parkedUntilMs > now) parkedUntil = parkedUntilMs;
}

export function markOsuParked(untilMs: number): void {
  if (untilMs > parkedUntil) parkedUntil = untilMs;
}

function prune(now: number): void {
  const windowStart = now - 60_000;
  while (hits.length > 0 && hits[0]! <= windowStart) hits.shift();
}

export function osuBudgetSnapshot(now = Date.now()): OsuBudgetSnapshot {
  prune(now);
  return {
    callsThisMinute: hits.length,
    limitPerMinute: OSU_MAX_PER_MINUTE,
    inFlight,
    maxInFlight: OSU_MAX_IN_FLIGHT,
    parkedUntil: parkedUntil > now ? parkedUntil : null,
    cacheHitsThisMinute: 0,
  };
}

/** Wait until a call is allowed, then count it. Caller must `releaseOsuSlot`. */
export async function acquireOsuSlot(now: Clock = Date.now): Promise<void> {
  for (;;) {
    const t = now();
    if (parkedUntil > t) {
      await sleep(Math.min(parkedUntil - t, 5_000));
      continue;
    }
    prune(t);
    if (inFlight < OSU_MAX_IN_FLIGHT && hits.length < OSU_MAX_PER_MINUTE) {
      inFlight += 1;
      hits.push(t);
      return;
    }
    const wait =
      hits.length >= OSU_MAX_PER_MINUTE && hits[0] != null
        ? hits[0] + 60_000 - t + 25
        : 40;
    await sleep(Math.max(25, wait));
  }
}

export function releaseOsuSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}
