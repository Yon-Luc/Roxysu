import { describe, expect, test } from "bun:test";
import {
  buildRatingLabAnalyseHtml,
  embedJson,
  osuCoverListUrl,
  osuWebManiaUrl,
  slimCompareRow,
  type AnalyseExportRow,
} from "./exportHtml";
import type { CompareRow } from "./compare";

function sampleRow(overrides: Partial<CompareRow> = {}): CompareRow {
  return {
    beatmapId: "local-1",
    onlineId: 12345,
    setOnlineId: 67890,
    title: "Song Title",
    artist: "Artist",
    difficultyName: "Another",
    keyCount: 7,
    importedStarRating: 6.5,
    baseline: {
      starRating: 6.5,
      starRatingSs: null,
      ppSs: 200,
      attributes: { speed_difficulty: 1 },
      error: null,
    },
    experiment: {
      starRating: 7.1,
      starRatingSs: 7.2,
      ppSs: 240,
      attributes: { variety: 1.05 },
      error: null,
    },
    delta: { starRating: 0.6, ppSs: 40 },
    cached: { baseline: true, experiment: true },
    ...overrides,
  };
}

describe("osuWebManiaUrl / osuCoverListUrl", () => {
  test("builds mania set deep-link and cover URL", () => {
    expect(osuWebManiaUrl(123, 456)).toBe(
      "https://osu.ppy.sh/beatmapsets/456#mania/123",
    );
    expect(osuCoverListUrl(456)).toBe(
      "https://assets.ppy.sh/beatmaps/456/covers/list@2x.jpg",
    );
  });

  test("falls back to /b/ when set is missing", () => {
    expect(osuWebManiaUrl(99, null)).toBe("https://osu.ppy.sh/b/99");
    expect(osuCoverListUrl(null)).toBeNull();
    expect(osuWebManiaUrl(null, 1)).toBeNull();
  });
});

describe("embedJson", () => {
  test("escapes angle brackets so </script> cannot break out", () => {
    const embedded = embedJson({ title: "</script><script>alert(1)" });
    expect(embedded).not.toContain("</script>");
    expect(embedded).toContain("\\u003c/script>");
    expect(JSON.parse(embedded).title).toBe("</script><script>alert(1)");
  });
});

describe("slimCompareRow", () => {
  test("drops attributes and keeps link fields", () => {
    const slim = slimCompareRow(sampleRow());
    expect(slim).toEqual({
      onlineId: 12345,
      setOnlineId: 67890,
      title: "Song Title",
      artist: "Artist",
      difficultyName: "Another",
      keyCount: 7,
      importedStarRating: 6.5,
      baseline: { starRating: 6.5, ppSs: 200, error: null },
      experiment: { starRating: 7.1, ppSs: 240, error: null },
      delta: { starRating: 0.6, ppSs: 40 },
      cached: { baseline: true, experiment: true },
    });
    expect(JSON.stringify(slim)).not.toContain("attributes");
    expect(JSON.stringify(slim)).not.toContain("speed_difficulty");
  });
});

describe("buildRatingLabAnalyseHtml", () => {
  const meta = {
    query: "mode:mania key=7 ranked",
    baselineVersionId: "lazer-master",
    experimentVersionId: "enissay-accuracy-change",
    baselineLabel: "Import (lazer)",
    experimentLabel: "Enissay accuracy change",
    usesImport: true,
    generatedAt: "2026-07-22T12:00:00.000Z",
  };

  test("embeds payload, cover/link patterns, and interactive hooks", () => {
    const rows: AnalyseExportRow[] = [
      slimCompareRow(
        sampleRow({
          title: "</script>Breakout",
          keyCount: 4,
          onlineId: 11,
          setOnlineId: 22,
        }),
      ),
      slimCompareRow(sampleRow({ keyCount: 7 })),
    ];

    const html = buildRatingLabAnalyseHtml(meta, rows);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('id="rating-lab-data"');
    expect(html).toContain('id="keymode-filter"');
    expect(html).toContain('id="name-filter"');
    expect(html).toContain('id="histogram"');
    expect(html).toContain("assets.ppy.sh/beatmaps/");
    expect(html).toContain("#mania/");
    expect(html).toContain("covers/list@2x.jpg");
    const histIdx = html.indexOf('id="histogram"');
    const resultsIdx = html.indexOf("<h2>Results</h2>");
    const moversIdx = html.indexOf("<h2>Largest SR movers</h2>");
    expect(histIdx).toBeGreaterThan(-1);
    expect(resultsIdx).toBeGreaterThan(histIdx);
    expect(moversIdx).toBeGreaterThan(resultsIdx);
    expect(html).not.toContain("</script>Breakout");
    expect(html).toContain("\\u003c/script>Breakout");
    expect(html).toContain(meta.query);
    expect(html).toContain(meta.baselineLabel);
    expect(html).toContain(meta.experimentLabel);
    expect(html).toContain("https://osu.ppy.sh/users/36810767");
    expect(html).toContain(
      "https://github.com/EnissayDev/osu/tree/enissay-mania-sr-rework",
    );
    expect(html).toContain(">Noy</a>");
  });

  test("hides Import ★ column wiring when usesImport is true", () => {
    const html = buildRatingLabAnalyseHtml(meta, [slimCompareRow(sampleRow())]);
    expect(html).toContain("meta.usesImport");
    // Column is only pushed when !meta.usesImport in the client script.
    expect(html).toContain("if (meta.usesImport)");
  });
});
