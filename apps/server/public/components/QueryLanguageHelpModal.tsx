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
  { field: "mods / mod", meaning: "Mods used on a score", example: "mods:DT" },
  { field: "acc / accuracy", meaning: "Best accuracy %", example: "acc>98" },
  { field: "retry", meaning: "Retry count", example: "retry>10" },
  { field: "mastery", meaning: "Mastery level", example: "mastery>80" },
  { field: "pp", meaning: "Best PP", example: "pp>=200" },
  { field: "played", meaning: "Played within N days", example: "played:last30d" },
];

const EXAMPLES = [
  "mode:mania stars:5..6",
  "mapper:Lasse OR mapper:Sotarks",
  "(mode:osu OR mode:mania) stars:6..7",
  "acc>98 NOT mods:NF",
  "title:^SL_5 mastery>50",
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
          "text-sm text-[#8b93a7] underline decoration-white/20 underline-offset-2 hover:text-[#a8b0c0]"
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
        className="max-h-[min(90vh,40rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-white/10 bg-[#151922] shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-white/10 bg-[#151922]/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-white">
              Query language
            </h2>
            <p className="mt-1 text-sm text-[#8b93a7]">
              Plain text searches titles and artists. Use{" "}
              <code className="text-[#a8b0c0]">field:value</code> for structured
              filters.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[#8b93a7] hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        <div className="space-y-6 px-5 py-5 text-sm">
          <Section title="Fields">
            <div className="overflow-hidden rounded-md border border-white/10">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-white/5 text-[#8b93a7]">
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
                      <td className="px-3 py-2 font-mono text-[#a8b0c0]">
                        {row.field}
                      </td>
                      <td className="px-3 py-2 text-[#c4c9d4]">{row.meaning}</td>
                      <td className="hidden px-3 py-2 font-mono text-[#8b93a7] sm:table-cell">
                        {row.example}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Numbers">
            <ul className="list-disc space-y-1.5 pl-5 text-[#c4c9d4]">
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
            <ul className="list-disc space-y-1.5 pl-5 text-[#c4c9d4]">
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
                  <code className="block rounded-md bg-[#0e1015] px-3 py-2 font-mono text-xs text-[#a8b0c0] sm:text-sm">
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8b93a7]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[0.85em] text-[#a8b0c0]">
      {children}
    </code>
  );
}
