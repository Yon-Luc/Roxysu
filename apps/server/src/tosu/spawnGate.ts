/**
 * Pure gate deciding whether the tosu adapter may spawn another tosu process.
 * Keeps auto-start from stacking detached children: a previous spawn that is
 * still alive blocks a new one, retries back off exponentially, and the gate
 * gives up after a small number of consecutive failed spawns.
 */

export const SPAWN_COOLDOWN_MS = 60_000;
export const MAX_SPAWN_ATTEMPTS = 3;
const MAX_BACKOFF_STEPS = 4;

export type SpawnGateState = {
  /** Epoch ms of the last spawn decision that was acted on (0 = never). */
  lastAttemptAt: number;
  /** Pid of the last spawned tosu, or null when none / spawn failed. */
  lastPid: number | null;
  /** Consecutive spawn attempts since the last reachable probe. */
  failedAttempts: number;
};

export type SpawnGateDecision =
  | { spawn: true }
  | { spawn: false; warning: string | null };

export function createSpawnGateState(): SpawnGateState {
  return { lastAttemptAt: 0, lastPid: null, failedAttempts: 0 };
}

/** Cooldown before the next spawn attempt, doubling per failed attempt. */
export function spawnCooldownMs(failedAttempts: number): number {
  const steps = Math.min(Math.max(failedAttempts - 1, 0), MAX_BACKOFF_STEPS);
  return SPAWN_COOLDOWN_MS * 2 ** steps;
}

/** True when a process with this pid exists (signal 0 probes without killing). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export function decideSpawn(
  state: SpawnGateState,
  now: number,
  alive: (pid: number) => boolean = isPidAlive,
): SpawnGateDecision {
  if (state.lastPid != null && alive(state.lastPid)) {
    return {
      spawn: false,
      warning: `Tosu was started (pid ${state.lastPid}) but is not reachable yet; not starting another copy.`,
    };
  }
  if (state.failedAttempts >= MAX_SPAWN_ATTEMPTS) {
    return {
      spawn: false,
      warning: `Tosu auto-start gave up after ${MAX_SPAWN_ATTEMPTS} attempts. Check the tosu executable path and host in Settings, or start tosu manually.`,
    };
  }
  if (
    state.failedAttempts > 0 &&
    now - state.lastAttemptAt < spawnCooldownMs(state.failedAttempts)
  ) {
    return { spawn: false, warning: null };
  }
  return { spawn: true };
}

/** Record the outcome of an acted-on spawn decision. */
export function recordSpawn(
  state: SpawnGateState,
  now: number,
  pid: number | null,
): void {
  state.lastAttemptAt = now;
  state.lastPid = pid;
  state.failedAttempts += 1;
}

/** tosu answered an HTTP probe: forget earlier spawns and failures. */
export function resetSpawnGate(state: SpawnGateState): void {
  state.lastAttemptAt = 0;
  state.lastPid = null;
  state.failedAttempts = 0;
}
