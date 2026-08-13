import { describe, expect, test } from "bun:test";
import {
  HUB_MODE_TAGS,
  HUB_TAG_GROUPS_BY_MODE,
  HUB_TAGS,
  HUB_TAGS_BY_MODE,
  hubSecondaryTagsForMode,
  hubTagGroupsForMode,
  type HubModeTag,
} from "../../lib/hub";

describe("hub tag taxonomy", () => {
  test("every mode has at least one non-empty tag group", () => {
    for (const mode of HUB_MODE_TAGS) {
      const groups = HUB_TAG_GROUPS_BY_MODE[mode];
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.label.trim().length).toBeGreaterThan(0);
        expect(group.tags.length).toBeGreaterThan(0);
      }
    }
  });

  test("tags are unique within each mode", () => {
    for (const mode of HUB_MODE_TAGS) {
      const tags = HUB_TAGS_BY_MODE[mode];
      expect(new Set(tags).size).toBe(tags.length);
    }
  });

  test("flat per-mode tags match the grouped tags", () => {
    for (const mode of HUB_MODE_TAGS) {
      const grouped: string[] = HUB_TAG_GROUPS_BY_MODE[mode].flatMap(
        (g) => g.tags,
      );
      const flat = HUB_TAGS_BY_MODE[mode];
      expect(flat.length).toBe(grouped.length);
      expect(flat.every((tag, i) => tag === grouped[i])).toBe(true);
    }
  });

  test("HUB_TAGS covers every mode and group tag", () => {
    const flat = new Set<string>(HUB_TAGS);
    for (const mode of HUB_MODE_TAGS) {
      expect(flat.has(mode)).toBe(true);
    }
    for (const tag of HUB_TAGS_BY_MODE.mania) {
      expect(flat.has(tag)).toBe(true);
    }
  });

  test("hubSecondaryTagsForMode matches the flat per-mode list", () => {
    for (const mode of HUB_MODE_TAGS) {
      expect(new Set<string>(hubSecondaryTagsForMode(mode))).toEqual(
        new Set<string>(HUB_TAGS_BY_MODE[mode]),
      );
    }
  });

  test("hubTagGroupsForMode returns grouped groups for a mode and a single all-mode group", () => {
    const mode = "mania" as HubModeTag;
    expect(hubTagGroupsForMode(mode)).toBe(HUB_TAG_GROUPS_BY_MODE.mania);
    const all = hubTagGroupsForMode("all");
    expect(all.length).toBe(1);
    expect(all[0]!.tags).toContain("multi-mode");
  });
});
