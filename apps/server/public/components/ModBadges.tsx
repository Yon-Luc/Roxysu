import { formatModAcronym, parseModEntries } from "@server/replay/mods";

type ModBadgesProps = {
  mods: string | null | undefined;
  className?: string;
  variant?: "default" | "overlay";
};

const BADGE_CLASS = {
  default:
    "rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted",
  overlay:
    "rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80 overlay-text",
} as const;

const NM_CLASS = {
  default:
    "rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint",
  overlay:
    "rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50 overlay-text",
} as const;

export function ModBadges({
  mods,
  className = "",
  variant = "default",
}: ModBadgesProps) {
  const entries = parseModEntries(mods);
  if (entries.length === 0) {
    return (
      <span className={`inline-flex shrink-0 items-center ${className}`}>
        <span className={NM_CLASS[variant]}>NM</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 flex-wrap items-center gap-1 ${className}`}
    >
      {entries.map((entry, index) => {
        const label = formatModAcronym(entry);
        const isRate = label.startsWith("X");
        return (
          <span
            key={`${label}-${index}`}
            className={
              isRate
                ? variant === "overlay"
                  ? "rounded-md bg-accent/25 px-1.5 py-0.5 text-[10px] font-bold tabular-nums tracking-wide text-accent overlay-text"
                  : "rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums tracking-wide text-accent"
                : BADGE_CLASS[variant]
            }
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}
