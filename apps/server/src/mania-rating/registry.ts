export type ManiaRatingSource = "import" | "computed";

export type ManiaRatingVersion = {
  id: string;
  label: string;
  description: string;
  /** Optional upstream git ref for documentation. */
  gitRef?: string;
  /** Use beatmaps.star_rating from Realm instead of a calculator binary. */
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

export function executableSettingKey(versionId: string): string {
  return `maniaRating.executable.${versionId}`;
}

export const LAZER_MASTER_VERSION = "lazer-master";
export const ENISSAY_ACCURACY_VERSION = "enissay-accuracy-change";

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
