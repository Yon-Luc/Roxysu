export type ManiaRatingSource = "import" | "computed" | "inprocess";

export type ManiaRatingVersion = {
  id: string;
  label: string;
  description: string;
  /** Optional upstream git ref for documentation. */
  gitRef?: string;
  /**
   * - import: Realm star_rating (+ optional C# binary for PP)
   * - computed: external mania-rating-calc binary (SR + PP)
   * - inprocess: TypeScript calculator in-repo (SR only, no .NET)
   */
  source: ManiaRatingSource;
};

const versions = new Map<string, ManiaRatingVersion>();

export function registerVersion(version: ManiaRatingVersion): void {
  versions.set(version.id, version);
}

export function getVersion(id: string): ManiaRatingVersion | undefined {
  return versions.get(id);
}

export function listVersions(): ManiaRatingVersion[] {
  return [...versions.values()];
}

export function usesImportedRating(versionId: string): boolean {
  return getVersion(versionId)?.source === "import";
}

export function usesInProcessCalculator(versionId: string): boolean {
  return getVersion(versionId)?.source === "inprocess";
}

/** True when this version needs a configured external calculator binary. */
export function requiresExecutable(versionId: string): boolean {
  const source = getVersion(versionId)?.source;
  return source === "computed";
}

export function executableSettingKey(versionId: string): string {
  return `maniaRating.executable.${versionId}`;
}

export const LAZER_MASTER_VERSION = "lazer-master";
export const ENISSAY_ACCURACY_VERSION = "enissay-accuracy-change";
/** In-process TS port of loeur362 mania-difficulty rework (SR only). */
export const MANIA_DIFFICULTY_TS_VERSION = "mania-difficulty-ts";

registerVersion({
  id: LAZER_MASTER_VERSION,
  label: "Import (lazer)",
  description:
    "Uses Realm-imported star rating. Configure the lazer-master binary to also compute SS PP max.",
  gitRef: "ppy/osu master",
  source: "import",
});

registerVersion({
  id: ENISSAY_ACCURACY_VERSION,
  label: "Enissay accuracy change",
  description:
    "Experimental 5-skill accuracy-curve SR and polynomial PP rework.",
  gitRef: "Natelytle/osu mania/enissay-mania-sr-rework-accuracy-change",
  source: "computed",
});

registerVersion({
  id: MANIA_DIFFICULTY_TS_VERSION,
  label: "Mania difficulty (TS port)",
  description:
    "In-process TypeScript port of the WIP mania SR rework. No .NET binary. Difficulty only (no PP tiers yet).",
  gitRef: "loleur362/osu mania-difficulty@e6207616bd732c7c00207a060f31cf7729f8390b",
  source: "inprocess",
});
