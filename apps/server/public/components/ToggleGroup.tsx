export function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-white/10 bg-panel p-0.5">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`rounded px-2.5 py-1 text-xs font-bold transition ${
            value === opt.id
              ? "bg-accent/20 text-accent"
              : "text-muted hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
