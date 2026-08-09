import {
  HUB_MODE_LABELS,
  HUB_MODE_TAGS,
  hubSecondaryTagsForMode,
  type HubModeTag,
  type HubTag,
} from "../../lib/hub";

export type HubTagFiltersProps = {
  mode: HubModeTag | "all";
  tags: HubTag[];
  onModeChange: (mode: HubModeTag | "all") => void;
  onTagsChange: (tags: HubTag[]) => void;
  /** When true, mode chips also toggle the mode tag in `tags` (share/edit). */
  selectModeAsTag?: boolean;
};

export function HubTagFilters({
  mode,
  tags,
  onModeChange,
  onTagsChange,
  selectModeAsTag = false,
}: HubTagFiltersProps) {
  const secondary = hubSecondaryTagsForMode(mode);
  const modeSet = new Set<string>(HUB_MODE_TAGS);

  function setMode(next: HubModeTag | "all") {
    onModeChange(next);
    if (!selectModeAsTag) {
      // Browse: mode is applied via dominantMode search, not as a tag chip.
      const nextSecondary = new Set(hubSecondaryTagsForMode(next));
      onTagsChange(
        tags.filter(
          (t) =>
            !modeSet.has(t) &&
            (next === "all" || nextSecondary.has(t) || t === "multi-mode"),
        ),
      );
      return;
    }

    const withoutModes = tags.filter((t) => !modeSet.has(t));
    if (next === "all") {
      onTagsChange(withoutModes);
    } else {
      onTagsChange([next, ...withoutModes] as HubTag[]);
    }
  }

  function toggleSecondary(tag: string) {
    const t = tag as HubTag;
    onTagsChange(
      tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t],
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rx-btn text-xs ${mode === "all" ? "rx-btn-primary" : ""}`}
          onClick={() => setMode("all")}
        >
          {HUB_MODE_LABELS.all}
        </button>
        {HUB_MODE_TAGS.map((m) => (
          <button
            key={m}
            type="button"
            className={`rx-btn text-xs ${mode === m ? "rx-btn-primary" : ""}`}
            onClick={() => setMode(m)}
          >
            {HUB_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {secondary.map((tag) => {
          const on = tags.includes(tag as HubTag);
          return (
            <button
              key={tag}
              type="button"
              className={`rx-btn text-xs ${on ? "rx-btn-primary" : ""}`}
              onClick={() => toggleSecondary(tag)}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
