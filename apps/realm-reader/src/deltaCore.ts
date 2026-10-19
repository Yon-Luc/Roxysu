/**
 * Streamed delta extraction + soft-delete / hidden flag healing.
 *
 * Realm-free (Realm access goes through `ExtractionSource`) so batching and
 * flag rules are testable under Bun. Rows are mapped and written in bounded
 * batches; dependencies (sets, beatmaps, rulesets) are hydrated per batch, so
 * peak heap does not scale with the size of the watermark delta.
 */
import {
  beatmapSets,
  beatmaps,
  rulesets,
  scores,
  eq,
  inArray,
  type Db,
} from "@roxysu/db/client.node";
import {
  mapBeatmap,
  mapBeatmapSet,
  mapRuleset,
  mapScore,
  type BeatmapRow,
  type BeatmapSetRow,
  type ScoreRow,
} from "./map";
import {
  FULL_ANALYTICS_ID_THRESHOLD,
  advanceWatermarks,
  withoutSkipped,
  type ExtractionWatermarks,
} from "./importJournal";
import { BATCH_SIZE, chunk, upsertBatches, type UpsertResult } from "./upsert";

export type FlagKind = "softScore" | "softSet" | "hiddenBeatmap";
export type RealmClass = "Beatmap" | "BeatmapSet" | "Score";

/** Read side of Realm used by extraction. The Realm adapter lives in sync.ts. */
export interface ExtractionSource {
  beatmapsUpdatedAfter(since: Date): Iterable<unknown>;
  scoresPlayedAfter(since: Date): Iterable<unknown>;
  /** Primary keys of Realm objects with the flag set (DeletePending / Hidden). */
  flaggedIds(kind: FlagKind): Iterable<string>;
  objectById(cls: RealmClass, id: string): unknown | null;
  rulesetsByShortName(shortName: string): Iterable<unknown>;
}

/**
 * Collects changed ids up to the analytics full-rebuild threshold, then drops
 * them and reports `null` (a full rebuild), so memory stays bounded.
 */
export class CappedIdSet {
  private ids = new Set<string>();
  private overflowed = false;

  add(id: string) {
    if (this.overflowed) return;
    this.ids.add(id);
    if (this.ids.size > FULL_ANALYTICS_ID_THRESHOLD) {
      this.overflowed = true;
      this.ids.clear();
    }
  }

  toList(): string[] | null {
    return this.overflowed ? null : [...this.ids];
  }
}

/** Ids in exactly one of the two collections (order-independent). */
export function symmetricDifference(
  a: Iterable<string>,
  b: Iterable<string>,
): string[] {
  const setA = new Set(a);
  const setB = new Set(b);
  const out: string[] = [];
  for (const id of setA) if (!setB.has(id)) out.push(id);
  for (const id of setB) if (!setA.has(id)) out.push(id);
  return out;
}

export function sqliteFlaggedIds(db: Db, kind: FlagKind): string[] {
  if (kind === "softScore") {
    return db
      .select({ id: scores.id })
      .from(scores)
      .where(eq(scores.deletePending, true))
      .all()
      .map((r) => r.id);
  }
  if (kind === "softSet") {
    return db
      .select({ id: beatmapSets.id })
      .from(beatmapSets)
      .where(eq(beatmapSets.deletePending, true))
      .all()
      .map((r) => r.id);
  }
  return db
    .select({ id: beatmaps.id })
    .from(beatmaps)
    .where(eq(beatmaps.hidden, true))
    .all()
    .map((r) => r.id);
}

/**
 * Map objects one at a time and hand them to `write` in bounded batches.
 * Never holds more than `size` mapped rows.
 */
export function streamInBatches<T>(
  objects: Iterable<unknown>,
  mapRow: (obj: unknown) => T | null,
  write: (rows: T[]) => void,
  size = BATCH_SIZE,
) {
  let buffer: T[] = [];
  for (const obj of objects) {
    const row = mapRow(obj);
    if (!row) continue;
    buffer.push(row);
    if (buffer.length >= size) {
      const batch = buffer;
      buffer = [];
      write(batch);
    }
  }
  if (buffer.length > 0) write(buffer);
}

export type UpsertTotals = { attempted: number; changed: number; skipped: number };

function emptyTotals(): UpsertTotals {
  return { attempted: 0, changed: 0, skipped: 0 };
}

function addTotals(into: UpsertTotals, result: UpsertResult) {
  into.attempted += result.attempted;
  into.changed += result.changed;
  into.skipped += result.skipped;
}

/**
 * Writes mapped rows with their dependencies, batch by batch, and tracks the
 * changed ids and the next watermarks. Order inside a batch is always
 * rulesets -> sets -> beatmaps -> scores so foreign keys hold at each commit.
 *
 * `attempted` totals can count a hydrated set or beatmap once per batch that
 * references it; `changed` counts only rows that actually differ.
 */
export class DeltaWriter {
  readonly totals = {
    rulesets: emptyTotals(),
    sets: emptyTotals(),
    beatmaps: emptyTotals(),
    scores: emptyTotals(),
  };
  readonly changedScores = new CappedIdSet();
  readonly changedBeatmaps = new CappedIdSet();
  watermarks: ExtractionWatermarks;
  private rulesetsDone = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly source: ExtractionSource,
    watermarks: ExtractionWatermarks,
  ) {
    this.watermarks = watermarks;
  }

  get rowsChanged(): number {
    return (
      this.totals.rulesets.changed +
      this.totals.sets.changed +
      this.totals.beatmaps.changed +
      this.totals.scores.changed
    );
  }

  private ensureRulesets(names: Iterable<string | null | undefined>) {
    const rows: Record<string, unknown>[] = [];
    for (const name of names) {
      if (!name || this.rulesetsDone.has(name)) continue;
      this.rulesetsDone.add(name);
      for (const obj of this.source.rulesetsByShortName(name)) {
        const row = mapRuleset(obj as never);
        if (row) rows.push(row as Record<string, unknown>);
      }
    }
    addTotals(
      this.totals.rulesets,
      upsertBatches(this.db, rulesets, rows, ["shortName"]),
    );
  }

  /** Refresh the sets a batch of beatmaps belongs to (set rows carry DeletePending). */
  private hydrateSets(setIds: Iterable<string>) {
    const rows: BeatmapSetRow[] = [];
    for (const id of new Set(setIds)) {
      const obj = this.source.objectById("BeatmapSet", id);
      if (!obj) continue;
      const row = mapBeatmapSet(obj as never);
      if (row) rows.push(row);
    }
    this.writeSets(rows);
  }

  writeSets(rows: BeatmapSetRow[]) {
    if (rows.length === 0) return;
    addTotals(
      this.totals.sets,
      upsertBatches(
        this.db,
        beatmapSets,
        rows as Record<string, unknown>[],
        ["id"],
      ),
    );
  }

  writeBeatmaps(rows: BeatmapRow[]) {
    if (rows.length === 0) return;
    this.ensureRulesets(rows.map((r) => r.rulesetShortName));
    this.hydrateSets(rows.map((r) => r.setId));
    const result = upsertBatches(
      this.db,
      beatmaps,
      rows as Record<string, unknown>[],
      ["id"],
    );
    addTotals(this.totals.beatmaps, result);
    for (const row of rows) this.changedBeatmaps.add(row.id as string);
    this.watermarks = advanceWatermarks(
      this.watermarks,
      [],
      withoutSkipped(
        rows as { id: string; lastLocalUpdate?: Date | number | null }[],
        result.skippedKeys,
      ),
    );
  }

  private presentBeatmapIds(ids: string[]): Set<string> {
    const found = new Set<string>();
    for (const batch of chunk(ids, BATCH_SIZE)) {
      const rows = this.db
        .select({ id: beatmaps.id })
        .from(beatmaps)
        .where(inArray(beatmaps.id, batch))
        .all();
      for (const row of rows) found.add(row.id);
    }
    return found;
  }

  writeScores(rows: ScoreRow[]) {
    if (rows.length === 0) return;

    // Beatmaps referenced by this batch but not yet in the local mirror are
    // hydrated from Realm; a reference that still cannot resolve is nulled.
    const referenced = [
      ...new Set(
        rows
          .map((r) => r.beatmapId)
          .filter((id): id is string => id != null),
      ),
    ];
    if (referenced.length > 0) {
      const present = this.presentBeatmapIds(referenced);
      const missing = referenced.filter((id) => !present.has(id));
      if (missing.length > 0) {
        const hydrated: BeatmapRow[] = [];
        for (const id of missing) {
          const obj = this.source.objectById("Beatmap", id);
          const mapped = obj ? mapBeatmap(obj as never) : null;
          if (mapped) hydrated.push(mapped);
        }
        this.writeBeatmaps(hydrated);
        const nowPresent = this.presentBeatmapIds(missing);
        const unresolved = new Set(missing.filter((id) => !nowPresent.has(id)));
        for (const row of rows) {
          if (row.beatmapId && unresolved.has(row.beatmapId)) {
            row.beatmapId = null;
          }
        }
      }
    }

    this.ensureRulesets(rows.map((r) => r.rulesetShortName));
    const result = upsertBatches(
      this.db,
      scores,
      rows as Record<string, unknown>[],
      ["id"],
    );
    addTotals(this.totals.scores, result);
    for (const row of rows) this.changedScores.add(row.id as string);
    this.watermarks = advanceWatermarks(
      this.watermarks,
      withoutSkipped(
        rows as { id: string; playedAt?: Date | number | null }[],
        result.skippedKeys,
      ),
      [],
    );
  }
}

function* objectsById(
  source: ExtractionSource,
  cls: RealmClass,
  ids: readonly string[],
): Generator<unknown> {
  for (const id of ids) {
    const obj = source.objectById(cls, id);
    if (obj) yield obj;
  }
}

/**
 * Soft-delete (Score, BeatmapSet) and hidden (Beatmap) flags: compare the id
 * sets of flagged Realm objects against flagged SQLite rows, and remap every
 * id in exactly one of them. Comparing only counts misses a restore plus a
 * delete that leave the totals equal; the Realm side of a restored id is
 * unflagged, so it must be fetched by primary key and remapped too.
 *
 * Ids whose Realm object no longer exists are skipped (orphan deletion owns
 * them).
 */
export function healFlaggedRows(writer: DeltaWriter, db: Db, source: ExtractionSource) {
  const scoreIds = symmetricDifference(
    source.flaggedIds("softScore"),
    sqliteFlaggedIds(db, "softScore"),
  );
  streamInBatches(
    objectsById(source, "Score", scoreIds),
    (obj) => mapScore(obj as never),
    (rows) => writer.writeScores(rows),
  );

  const setIds = symmetricDifference(
    source.flaggedIds("softSet"),
    sqliteFlaggedIds(db, "softSet"),
  );
  streamInBatches(
    objectsById(source, "BeatmapSet", setIds),
    (obj) => mapBeatmapSet(obj as never),
    (rows) => writer.writeSets(rows),
  );

  const beatmapIds = symmetricDifference(
    source.flaggedIds("hiddenBeatmap"),
    sqliteFlaggedIds(db, "hiddenBeatmap"),
  );
  streamInBatches(
    objectsById(source, "Beatmap", beatmapIds),
    (obj) => mapBeatmap(obj as never),
    (rows) => writer.writeBeatmaps(rows),
  );
}

/**
 * Incremental cycle body: stream the watermark delta in bounded batches, then
 * heal flags. Writes autocommit per batch; the watermark only lands with the
 * import's commit phase, so an interrupted run re-reads the same delta.
 */
export function streamIncrementalDelta(
  db: Db,
  source: ExtractionSource,
  watermarks: ExtractionWatermarks,
): DeltaWriter {
  const writer = new DeltaWriter(db, source, watermarks);

  if (watermarks.maxLastLocalUpdate) {
    streamInBatches(
      source.beatmapsUpdatedAfter(watermarks.maxLastLocalUpdate),
      (obj) => mapBeatmap(obj as never),
      (rows) => writer.writeBeatmaps(rows),
    );
  }

  if (watermarks.maxPlayedAt) {
    streamInBatches(
      source.scoresPlayedAfter(watermarks.maxPlayedAt),
      (obj) => mapScore(obj as never),
      (rows) => writer.writeScores(rows),
    );
  }

  healFlaggedRows(writer, db, source);
  return writer;
}
