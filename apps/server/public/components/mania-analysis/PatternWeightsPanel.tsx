import { useAppDict } from "../../lib/i18n";
import {
  formatPatternLabel,
  weightPatternsForKeyCount,
} from "./formatPatternLabel";

export function PatternWeightsPanel({
  composition,
  keyCount,
  accentColor,
  title,
}: {
  composition: Record<string, number>;
  keyCount: number | null;
  accentColor: string;
  /** Override title; defaults to practice.detail.patternWeights */
  title?: string;
}) {
  const { dict } = useAppDict();
  const detail = dict?.practice.detail;
  const patterns = weightPatternsForKeyCount(keyCount);
  const rows = patterns.map((pattern) => ({
    pattern,
    label: formatPatternLabel(pattern, detail?.patterns),
    value: composition[pattern] ?? 0,
  }));

  return (
    <div className="rounded-xl border border-white/8 bg-black/10 p-4">
      <h3 className="text-sm font-bold text-ink">
        {title ?? detail?.patternWeights}
      </h3>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <PatternMetricRow
            key={row.pattern}
            label={row.label}
            value={row.value}
            accentColor={accentColor}
          />
        ))}
      </div>
    </div>
  );
}

function PatternMetricRow({
  label,
  value,
  accentColor,
}: {
  label: string;
  value: number;
  accentColor: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-subtle">{label}</span>
        <span className="tabular-nums text-muted">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: accentColor }}
        />
      </div>
    </div>
  );
}
