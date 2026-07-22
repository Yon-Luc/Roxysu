export type ManiaRatingVersion = {
  id: string;
  label: string;
  description: string;
  /** Optional upstream git ref for documentation. */
  gitRef?: string;
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

export function executableSettingKey(versionId: string): string {
  return `maniaRating.executable.${versionId}`;
}

export const LAZER_MASTER_VERSION = "lazer-master";
export const ENISSAY_ACCURACY_VERSION = "enissay-accuracy-change";

registerVersion({
  id: LAZER_MASTER_VERSION,
  label: "Lazer master",
  description:
    "Current osu!lazer mania SR and PP from master branch calculators.",
  gitRef: "ppy/osu master",
});

registerVersion({
  id: ENISSAY_ACCURACY_VERSION,
  label: "Enissay accuracy change",
  description:
    "Experimental 5-skill accuracy-curve SR and polynomial PP rework.",
  gitRef: "Natelytle/osu mania/enissay-mania-sr-rework-accuracy-change",
});
