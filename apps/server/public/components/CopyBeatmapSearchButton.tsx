import { useEffect, useState } from "react";
import { beatmapSearchText } from "../lib/format";

type Props = {
  title: string | null | undefined;
  difficultyName?: string | null;
  className?: string;
};

export function CopyBeatmapSearchButton({
  title,
  difficultyName,
  className = "rx-btn",
}: Props) {
  const [copied, setCopied] = useState(false);
  const text = beatmapSearchText(title, difficultyName);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      className={className}
      title={`Copy "${text}" for in-game search`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard may be denied; leave label unchanged.
        }
      }}
    >
      {copied ? "Copied!" : "Copy for search"}
    </button>
  );
}
