import { subscribe } from "../shared/events";
import type { ScoreGamemodeId } from "./scoreGamemode";

/** Short TTL so cold-start fan-out shares one GROUP BY; safety if an event is missed. */
const TTL_MS = 60_000;

type Entry<T> = { at: number; value: T };

let usernameEntry: Entry<string | null> | null = null;
let gamemodeEntry: Entry<ScoreGamemodeId | null> | null = null;

function readEntry<T>(entry: Entry<T> | null): T | undefined {
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) return undefined;
  return entry.value;
}

/** `undefined` = miss; otherwise the cached most-common username (may be null). */
export function getCachedMostCommonUsername(): string | null | undefined {
  return readEntry(usernameEntry);
}

export function setCachedMostCommonUsername(value: string | null): void {
  usernameEntry = { at: Date.now(), value };
}

/** `undefined` = miss; otherwise the cached most-common gamemode (may be null). */
export function getCachedMostCommonGamemode():
  | ScoreGamemodeId
  | null
  | undefined {
  return readEntry(gamemodeEntry);
}

export function setCachedMostCommonGamemode(
  value: ScoreGamemodeId | null,
): void {
  gamemodeEntry = { at: Date.now(), value };
}

export function invalidateScoreAutoFilterCache(): void {
  usernameEntry = null;
  gamemodeEntry = null;
}

function shouldInvalidate(type: string): boolean {
  return (
    type === "score.imported" ||
    type === "score.updated" ||
    type === "sync.finished" ||
    type === "mastery.updated"
  );
}

subscribe((event) => {
  if (shouldInvalidate(event.type)) invalidateScoreAutoFilterCache();
});
