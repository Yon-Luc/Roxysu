import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BeatmapInsightsRepository } from "../database/BeatmapInsightsRepository";
import { BeatmapRepository } from "../database/BeatmapRepository";
import { CollectionRepository } from "../database/CollectionRepository";
import { PlaySessionRepository } from "../database/PlaySessionRepository";
import { ScoreRepository } from "../database/ScoreRepository";
import {
  beatmapSets,
  beatmaps,
  closeDb,
  ensureDb,
  realmCollectionHashes,
  realmCollections,
  type Db,
} from "../integrations/roxysu-db";
import { RoxysuCatalog } from "../roxysu/RoxysuCatalog";
import { SongSelect } from "./SongSelect";

let dir: string;
let db: Db;

function seedBeatmap(
  id: string,
  ruleset: string,
  circleSize: number,
  title: string,
) {
  db.insert(beatmaps)
    .values({
      id,
      onlineId: Number(id.replace(/\D/g, "")) || 0,
      setId: "set-1",
      rulesetShortName: ruleset,
      status: 1,
      length: 1000,
      bpm: 120,
      starRating: 3,
      md5Hash: `md5-${id}`,
      circleSize,
      title,
    })
    .run();
}

function build(keys = 7) {
  const collections = new CollectionRepository(db);
  const beatmapRepo = new BeatmapRepository(db);
  const catalog = new RoxysuCatalog(
    new ScoreRepository(db),
    new BeatmapInsightsRepository(db),
    collections,
    new PlaySessionRepository(db),
  );
  const assets = {
    resolveBeatmap: () => ({ status: "missing" }),
  } as never;
  return { collections, select: new SongSelect(beatmapRepo, catalog, assets, keys) };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "roxysu-play-songselect-"));
  db = ensureDb(path.join(dir, "data.sqlite"));
  db.insert(beatmapSets)
    .values({ id: "set-1", onlineId: 1, dateAdded: new Date(0), status: 1 })
    .run();
  seedBeatmap("m7-a", "mania", 7, "A");
  seedBeatmap("m7-b", "mania", 7, "B");
  seedBeatmap("m4", "mania", 4, "C");
  seedBeatmap("std7", "osu", 7, "D");
  seedBeatmap("std5", "osu", 5, "E");
  db.insert(realmCollections)
    .values({
      id: "col-1",
      name: "Mixed",
      hashCount: 5,
      syncedAt: new Date(0),
    })
    .run();
  for (const id of ["m7-a", "m7-b", "m4", "std7", "std5"]) {
    db.insert(realmCollectionHashes)
      .values({ collectionId: "col-1", md5Hash: `md5-${id}` })
      .run();
  }
});

afterEach(() => {
  closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("CollectionRepository.getRealmBeatmapIds", () => {
  test("without a filter returns every beatmap of the collection", () => {
    const { collections } = build();
    expect(collections.getRealmBeatmapIds("col-1").sort()).toEqual([
      "m4",
      "m7-a",
      "m7-b",
      "std5",
      "std7",
    ]);
  });

  test("filters ruleset and key count in one query", () => {
    const { collections } = build();
    expect(
      collections
        .getRealmBeatmapIds("col-1", { ruleset: "mania", keys: 7 })
        .sort(),
    ).toEqual(["m7-a", "m7-b"]);
    expect(
      collections.getRealmBeatmapIds("col-1", { ruleset: "mania", keys: 4 }),
    ).toEqual(["m4"]);
    expect(
      collections.getRealmBeatmapIds("col-1", { ruleset: "mania", keys: 9 }),
    ).toEqual([]);
  });
});

describe("SongSelect Realm collection filter", () => {
  test("keeps only mania maps of the selected key count", () => {
    const { select } = build(7);
    const page = select.search({
      collection: {
        kind: "realm",
        id: "col-1",
        name: "Mixed",
        mapCount: 5,
      },
    });
    expect(page.collectionFilterActive).toBe(true);
    expect(page.total).toBe(2);
    expect(page.entries.map((e) => e.id).sort()).toEqual(["m7-a", "m7-b"]);
  });

  test("does not look beatmaps up one by one", () => {
    const { select } = build(7);
    const repo = (select as unknown as { beatmaps: BeatmapRepository })
      .beatmaps;
    let lookups = 0;
    const original = repo.getById.bind(repo);
    repo.getById = (id: string) => {
      lookups++;
      return original(id);
    };
    select.search({
      collection: { kind: "realm", id: "col-1", name: "Mixed", mapCount: 5 },
    });
    expect(lookups).toBe(0);
  });
});
