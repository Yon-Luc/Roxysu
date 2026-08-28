export type BeatmapGeneralSettings = {
  previewTimeMs: number | null;
  audioLeadInMs: number;
  countdown: number;
};

export function parseBeatmapGeneral(osuText: string): BeatmapGeneralSettings {
  const fields: Record<string, string> = {};
  let inGeneral = false;

  for (const line of osuText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[General]") {
      inGeneral = true;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inGeneral = false;
      continue;
    }
    if (!inGeneral || !trimmed.includes(":")) continue;

    const splitAt = trimmed.indexOf(":");
    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1).trim();
    fields[key] = value;
  }

  const previewRaw = Number(fields.PreviewTime ?? -1);
  const leadInRaw = Number(fields.AudioLeadIn ?? 0);
  const countdownRaw = Number(fields.Countdown ?? 0);

  return {
    previewTimeMs:
      Number.isFinite(previewRaw) && previewRaw >= 0 ? previewRaw : null,
    audioLeadInMs: Number.isFinite(leadInRaw) ? Math.max(0, leadInRaw) : 0,
    countdown: Number.isFinite(countdownRaw) ? Math.max(0, countdownRaw) : 0,
  };
}
