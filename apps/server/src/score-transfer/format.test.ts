import { describe, expect, test } from "bun:test";
import {
  buildTransferIndex,
  classifyTransferScore,
  type TransferFinger,
} from "../../../realm-reader/src/scoreTransferMatch";
import { parseScoreTransferFile, type ScoreTransferRow } from "./format";

function row(patch: Partial<ScoreTransferRow> = {}): ScoreTransferRow {
  return {
    onlineId: 10,
    legacyOnlineId: 3,
    beatmapOnlineId: 99,
    beatmapMd5: "abc",
    beatmapHash: "sha",
    ruleset: "mania",
    clientVersion: "2024.1",
    totalScore: 900_000,
    totalScoreWithoutMods: 900_000,
    legacyTotalScore: 800_000,
    maxCombo: 400,
    combo: 200,
    accuracy: 0.98,
    pp: 200,
    rank: 4,
    mods: "[]",
    statistics: "{\"Great\":1}",
    maximumStatistics: "{\"Perfect\":400}",
    playedAt: Date.parse("2024-01-01T00:00:00Z"),
    userOnlineId: 7,
    username: "player",
    isLegacy: false,
    ...patch,
  };
}

const beatmap = { onlineId: 99, md5Hash: "abc", hash: "sha" };

function finger(patch: Partial<ScoreTransferRow> = {}): TransferFinger {
  const score = row(patch);
  return {
    onlineId: score.onlineId,
    legacyOnlineId: score.legacyOnlineId,
    beatmapOnlineId: score.beatmapOnlineId,
    beatmapMd5: score.beatmapMd5,
    beatmapHash: score.beatmapHash,
    ruleset: score.ruleset,
    playedAtMs: score.playedAt,
    totalScore: score.totalScore,
    legacyTotalScore: score.legacyTotalScore,
  };
}

describe("parseScoreTransferFile", () => {
  test("rejects a file that is not a score transfer", () => {
    expect(parseScoreTransferFile({ format: "other", version: 1, scores: [] })).toEqual({
      error: "This file is not a Roxysu score transfer.",
    });
  });

  test("keeps valid rows and counts invalid ones", () => {
    const parsed = parseScoreTransferFile({
      format: "roxysu-scores",
      version: 1,
      exportedAt: "2024-01-01T00:00:00.000Z",
      scores: [row(), { ruleset: "mania" }],
    });
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.file.scores).toHaveLength(1);
    expect(parsed.invalid).toBe(1);
  });
});

describe("classifyTransferScore", () => {
  test("matches an existing online id", () => {
    const index = buildTransferIndex([finger()], []);
    expect(classifyTransferScore(finger({ beatmapMd5: null, beatmapHash: null }), index)).toBe(
      "already",
    );
  });

  test("does not treat online id 0 as an identity", () => {
    const index = buildTransferIndex(
      [finger({ onlineId: 0, legacyOnlineId: 0, playedAt: 1, totalScore: 1 })],
      [],
    );
    expect(
      classifyTransferScore(finger({ onlineId: 0, legacyOnlineId: 0, beatmapOnlineId: 0 }), index),
    ).toBe("skipped");
  });

  test("matches a local play by beatmap, time, and total score", () => {
    const playedAt = row().playedAt;
    const index = buildTransferIndex(
      [finger({ onlineId: 0, legacyOnlineId: -1, playedAt })],
      [],
    );
    expect(
      classifyTransferScore(finger({ onlineId: 0, legacyOnlineId: 0, playedAt: playedAt + 1000 }), index),
    ).toBe("already");
  });

  test("adds when the checksum matches", () => {
    const index = buildTransferIndex([], [beatmap]);
    expect(classifyTransferScore(finger({ onlineId: 0, legacyOnlineId: 0 }), index)).toBe("add");
  });

  test("attaches a positive online id to the current file when the checksum differs", () => {
    const index = buildTransferIndex([], [beatmap]);
    expect(
      classifyTransferScore(
        finger({ onlineId: 0, legacyOnlineId: 0, beatmapMd5: "other" }),
        index,
      ),
    ).toBe("add-current-version");
  });

  test("does not attach online id 0 to another unsubmitted map", () => {
    const index = buildTransferIndex([], [{ onlineId: 0, md5Hash: "nope", hash: "other" }]);
    expect(
      classifyTransferScore(
        finger({
          onlineId: 0,
          legacyOnlineId: 0,
          beatmapOnlineId: 0,
          beatmapMd5: "abc",
          beatmapHash: "missing",
        }),
        index,
      ),
    ).toBe("skipped");
  });
});
