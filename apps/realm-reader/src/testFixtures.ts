/** Fake Realm objects + an in-memory `ExtractionSource` for Realm-free tests. */
import type {
  ExtractionSource,
  FlagKind,
  RealmClass,
} from "./deltaCore";

function pad(prefix: string, n: number): string {
  return `${prefix}${n.toString().padStart(7, "0")}-0000-0000-0000-000000000000`;
}

export const setId = (n: number) => pad("1", n);
export const beatmapId = (n: number) => pad("2", n);
export const scoreId = (n: number) => pad("3", n);

export type FakeObj = Record<string, unknown>;

export function fakeSet(n: number, overrides: FakeObj = {}): FakeObj {
  return {
    ID: setId(n),
    OnlineID: n,
    DateAdded: new Date(2026, 0, 1),
    DateSubmitted: null,
    DateRanked: null,
    Status: 4,
    DeletePending: false,
    Hash: null,
    Protected: false,
    ...overrides,
  };
}

export function fakeBeatmap(
  n: number,
  setN: number,
  overrides: FakeObj = {},
): FakeObj {
  return {
    ID: beatmapId(n),
    OnlineID: n,
    BeatmapSet: { ID: setId(setN), Files: [] },
    DifficultyName: `diff ${n}`,
    Ruleset: { ShortName: "mania" },
    Status: 0,
    Length: 90,
    BPM: 180,
    StarRating: 5,
    MD5Hash: null,
    Hash: null,
    Hidden: false,
    TotalObjectCount: 12,
    EndTimeObjectCount: 12,
    LastLocalUpdate: new Date(2026, 1, 1),
    ...overrides,
  };
}

export function fakeScore(
  n: number,
  beatmapN: number | null,
  overrides: FakeObj = {},
): FakeObj {
  return {
    ID: scoreId(n),
    OnlineID: n,
    LegacyOnlineID: 0,
    BeatmapInfo: beatmapN == null ? null : { ID: beatmapId(beatmapN) },
    BeatmapHash: null,
    Ruleset: { ShortName: "mania" },
    ClientVersion: null,
    TotalScore: 100,
    TotalScoreWithoutMods: 100,
    LegacyTotalScore: null,
    MaxCombo: 1,
    Combo: 1,
    Accuracy: 1,
    PP: null,
    Rank: 1,
    Mods: null,
    Statistics: null,
    MaximumStatistics: null,
    Date: new Date(2026, 2, 1),
    User: { OnlineID: 1, Username: "a" },
    IsLegacyScore: false,
    DeletePending: false,
    Hash: null,
    Files: [],
    ...overrides,
  };
}

export class FakeRealm implements ExtractionSource {
  sets = new Map<string, FakeObj>();
  beatmaps = new Map<string, FakeObj>();
  scores = new Map<string, FakeObj>();
  /** Objects handed out by the delta iterators so far (proves streaming). */
  yielded = 0;
  lookups: { cls: RealmClass; id: string; yieldedAtLookup: number }[] = [];

  addSet(o: FakeObj) {
    this.sets.set(o.ID as string, o);
    return o;
  }
  addBeatmap(o: FakeObj) {
    this.beatmaps.set(o.ID as string, o);
    return o;
  }
  addScore(o: FakeObj) {
    this.scores.set(o.ID as string, o);
    return o;
  }

  *beatmapsUpdatedAfter(since: Date) {
    for (const o of this.beatmaps.values()) {
      if ((o.LastLocalUpdate as Date) > since) {
        this.yielded += 1;
        yield o;
      }
    }
  }

  *scoresPlayedAfter(since: Date) {
    for (const o of this.scores.values()) {
      if ((o.Date as Date) > since) {
        this.yielded += 1;
        yield o;
      }
    }
  }

  *flaggedIds(kind: FlagKind) {
    if (kind === "softScore") {
      for (const o of this.scores.values()) if (o.DeletePending) yield o.ID as string;
    } else if (kind === "softSet") {
      for (const o of this.sets.values()) if (o.DeletePending) yield o.ID as string;
    } else {
      for (const o of this.beatmaps.values()) if (o.Hidden) yield o.ID as string;
    }
  }

  objectById(cls: RealmClass, id: string) {
    this.lookups.push({ cls, id, yieldedAtLookup: this.yielded });
    const map =
      cls === "Beatmap" ? this.beatmaps : cls === "BeatmapSet" ? this.sets : this.scores;
    return map.get(id) ?? null;
  }

  rulesetsByShortName(shortName: string) {
    return [{ ShortName: shortName, OnlineID: 3, Name: shortName, Available: true }];
  }
}
