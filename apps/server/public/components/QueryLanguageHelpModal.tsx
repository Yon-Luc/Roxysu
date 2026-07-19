import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const FIELDS: { field: string; meaning: string; example: string }[] = [
  { field: "mode", meaning: "Ruleset short name", example: "mode:mania" },
  { field: "mapper", meaning: "Mapper username", example: "mapper:Lasse" },
  { field: "title", meaning: "Beatmap title (use ^ for prefix)", example: "title:^SL_5" },
  { field: "artist", meaning: "Artist name (use ^ for prefix)", example: "artist:Camellia" },
  {
    field: "diff / difficulty",
    meaning: "Difficulty name (use ^ for prefix)",
    example: "diff:Insane",
  },
  { field: "stars / star", meaning: "Star rating range or comparison", example: "stars:5..6" },
  {
    field: "key / keys",
    meaning: "Mania key count (implies mode:mania)",
    example: "key=7",
  },
  { field: "mods / mod", meaning: "Mods used on a score", example: "mods:DT" },
  { field: "acc / accuracy", meaning: "Best accuracy % (range or comparison)", example: "acc:90..92" },
  { field: "misses / miss", meaning: "Best (fewest) miss count", example: "misses:0" },
  { field: "score", meaning: "Best total score", example: "score>=900000" },
  { field: "retry", meaning: "Retry count", example: "retry>10" },
  { field: "mastery", meaning: "Mastery level", example: "mastery>80" },
  { field: "pp", meaning: "Best PP", example: "pp>=200" },
  {
    field: "played",
    meaning: "Played within N days, or never (use NOT played:lastNd for stale)",
    example: "played:never",
  },
];

const EXAMPLES = [
  "mode:mania stars:5..6",
  "key=7 stars:5..6",
  "mapper:Lasse OR mapper:Sotarks",
  "(mode:osu OR mode:mania) stars:6..7",
  "acc>98 NOT mods:NF",
  "mode:mania acc:96..98",
  "title:^SL_5 mastery>50",
  "acc:90..93 NOT played:last14d",
];

export function QueryLanguageHelpButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "text-sm font-medium text-muted underline decoration-white/20 underline-offset-2 transition hover:text-accent"
        }
      >
        Query language help
      </button>
      {open ? <QueryLanguageHelpModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function QueryLanguageHelpModal({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[min(90vh,40rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-white/5 bg-elevated/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 id={titleId} className="font-display text-xl font-bold text-ink">
              Query language
            </h2>
            <p className="mt-1 text-sm text-muted">
              Plain text searches titles and artists. Use{" "}
              <code className="text-subtle">field:value</code> for structured
              filters.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm text-muted transition hover:bg-highlight hover:text-ink"
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        <div className="space-y-6 px-5 py-5 text-sm">
          <Section title="Fields">
            <div className="overflow-hidden rounded-xl bg-surface">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-highlight/60 text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Meaning</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">
                      Example
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {FIELDS.map((row) => (
                    <tr key={row.field}>
                      <td className="px-3 py-2 font-mono text-subtle">
                        {row.field}
                      </td>
                      <td className="px-3 py-2 text-subtle">{row.meaning}</td>
                      <td className="hidden px-3 py-2 font-mono text-muted sm:table-cell">
                        {row.example}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Numbers">
            <ul className="list-disc space-y-1.5 pl-5 text-subtle">
              <li>
                Comparisons:{" "}
                <Code>acc&gt;98</Code>, <Code>mastery&gt;=50</Code>,{" "}
                <Code>pp=300</Code>
              </li>
              <li>
                Ranges: <Code>stars:5..6</Code> (inclusive)
              </li>
              <li>
                Bare number after a field means ≥ that value: <Code>acc:98</Code>
              </li>
              <li>
                Glued form works too: <Code>stars&gt;5</Code>, <Code>retry&gt;10</Code>
              </li>
            </ul>
          </Section>

          <Section title="Boolean logic">
            <ul className="list-disc space-y-1.5 pl-5 text-subtle">
              <li>
                <Code>AND</Code>, <Code>OR</Code>, <Code>NOT</Code> (case-insensitive)
              </li>
              <li>
                Space between terms is AND:{" "}
                <Code>mode:mania stars:5..6</Code>
              </li>
              <li>
                Group with parentheses:{" "}
                <Code>(mode:osu OR mode:mania) stars:6..7</Code>
              </li>
            </ul>
          </Section>

          <Section title="Examples">
            <ul className="space-y-2">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <code className="block rounded-xl bg-surface px-3 py-2 font-mono text-xs text-subtle sm:text-sm">
                    {ex}
                  </code>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-faint">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-highlight px-1 py-0.5 font-mono text-[0.85em] text-subtle">
      {children}
    </code>
  );
}
