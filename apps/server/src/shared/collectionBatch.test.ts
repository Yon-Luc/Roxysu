import { describe, expect, test } from "bun:test";
import { selectNewCollectionRows } from "./collectionBatch";

describe("selectNewCollectionRows", () => {
  test("skips stored names and later duplicates", () => {
    const result = selectNewCollectionRows(
      [
        { name: "7K rework 1-2", query: "key:7 reworkstars:>=1 reworkstars:<2" },
        { name: "7K rework 2-3", query: "key:7 reworkstars:>=2 reworkstars:<3" },
        { name: "7K rework 1-2", query: "key:7 reworkstars:>=1 reworkstars:<2" },
        { name: "7K Regular 10", query: 'key:7 dan:"Regular 10"' },
      ],
      ["7K rework 2-3"],
    );
    expect(result.skipped).toBe(2);
    expect(result.insert.map((row) => row.name)).toEqual([
      "7K rework 1-2",
      "7K Regular 10",
    ]);
  });
});
