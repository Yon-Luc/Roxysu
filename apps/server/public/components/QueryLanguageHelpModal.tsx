import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const FIELDS: { field: string; meaning: string; example: string }[] = [
  {
    field: "mode",
    meaning: "Ruleset short name. catch and ctb match fruits.",
    example: "mode:ctb",
  },
  {
    field: "status / ranked / loved",
    meaning:
      "Beatmap set status: ranked, loved, pending, qualified, approved, graveyard, wip, none. Use status:ranked, status=r, or bare ranked. Online statuses (ranked/loved/pending/qualified/approved/graveyard) also require an osu beatmap ID (website link).",
    example: "mode:mania key=7 status=r",
  },
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
    field: "ar / approachrate",
    meaning: "Approach rate. Local library only (not Download Maps).",
    example: "ar>=9",
  },
  {
    field: "cs / circlesize",
    meaning:
      "Circle size on any ruleset. Not mania keys (use key:) and not pattern:cs (chordstream). Local library only.",
    example: "cs:4..4.5",
  },
  {
    field: "od / overalldifficulty",
    meaning: "Overall difficulty. Local library only.",
    example: "od:8..9",
  },
  {
    field: "hp / drainrate",
    meaning: "HP drain. Local library only.",
    example: "hp<6",
  },
  {
    field: "key / keys",
    meaning: "Mania key count (implies mode:mania)",
    example: "key=7",
  },
  {
    field: "ln / lns",
    meaning: "Mania long-note % (implies mode:mania)",
    example: "ln<10",
  },
  {
    field: "dan",
    meaning:
      "Rework dan label (alias of rework:). Matches mania difficulty port tiers via expandReworkDanMatch. Quote multi-word labels.",
    example: 'key=4 dan:"Reform 5"',
  },
  {
    field: "pattern / dominant / style",
    meaning:
      "Skill (speed, jack, coordination, technical, release) or chart shape (stream, trill, jumptrill, chordjack, chordstream on any key count; jumpstream and handstream are 4K only; bracket is 7K and other non-4K modes). pattern:jack is the jack skill. pattern:delay matches stream.",
    example: "pattern:jumpstream key=4",
  },
  {
    field: "rework / reworkdan",
    meaning:
      "Rework dan tier from the mania difficulty port (Alpha, LN 14, Regular Zenith).",
    example: 'rework:"LN 14" key=4',
  },
  {
    field: "reworkstars",
    meaning: "Rework star rating range.",
    example: "reworkstars:6.5..9",
  },
  {
    field: "axis / rice / lnmap",
    meaning:
      "RC vs LN map split from rework LN ratio (≥20% LN = LN map). Same threshold as dan labels.",
    example: "key=7 axis:rc pattern:jack",
  },
  { field: "mods / mod", meaning: "Mods used on a score", example: "mods:DT" },
  { field: "acc / accuracy", meaning: "Best accuracy % (range or comparison)", example: "acc:90..92" },
  { field: "misses / miss", meaning: "Best (fewest) miss count", example: "misses:0" },
  { field: "score", meaning: "Best total score", example: "score>=900000" },
  {
    field: "grade / rank",
    meaning:
      "Best nomod/mirror score grade (D/C/B/A/S/SS/X). S includes SH; SS is Perfect/Marvelous; X is 1,000,000 (all Marvelous).",
    example: "key=7 grade:SS",
  },
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
  "mode:mania key=7 ranked",
  "mode:mania status:ranked,loved stars:6..8",
  "mode:mania stars:5..6",
  "mode:osu ar>=9 cs:4",
  "od:8..9 hp>=5",
  "key=7 stars:5..6",
  "key=7 ln<10",
  "key=4 dan:Reform",
  'key=7 dan:"Regular 4"',
  "key=7 dan:Regular reworkstars:6..8",
  "pattern:jack",
  "key=7 pattern:jack",
  "key=7 axis:rc pattern:speed",
  "key=7 axis:ln pattern:release",
  "pattern:speed stars:4..6",
  "pattern:technical key=7",
  "pattern:jack OR pattern:coordination",
  "pattern:jumpstream",
  "key=7 pattern:bracket",
  "key=7 pattern:chordjack",
  "dan:Alpha OR dan:Beta",
  "rework:Alpha",
  'rework:"Regular Zenith"',
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
          "text-sm font-medium text-accent underline decoration-accent/40 underline-offset-2 transition hover:text-ink"
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
        className="flex max-h-[min(90vh,40rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div>
            <h2 id={titleId} className="font-display text-xl font-bold text-ink">
              Query language
            </h2>
            <p className="mt-1 text-sm text-muted">
              Plain text searches titles and artists. Use{" "}
              <code className="text-subtle">field:value</code> for structured
              filters.
            </p>
            <p className="mt-2 text-sm text-muted">
              Download Maps supports the catalog subset only:{" "}
              <code className="text-subtle">status</code>,{" "}
              <code className="text-subtle">mode</code>,{" "}
              <code className="text-subtle">key/keys</code>,{" "}
              <code className="text-subtle">stars</code>,{" "}
              <code className="text-subtle">mapper</code>,{" "}
              <code className="text-subtle">title</code>,{" "}
              <code className="text-subtle">artist</code>, and free text (AND
              only). Score and practice fields, plus ar, cs, od, and hp, are
              local-library only.
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 px-5 py-5 text-sm">
            <Section title="Fields">
              <div className="overflow-hidden rounded-xl bg-surface">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-highlight/60 text-muted">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">
                        Field
                      </th>
                      <th className="px-3 py-2 font-medium">Meaning</th>
                      <th className="hidden whitespace-nowrap px-3 py-2 font-medium sm:table-cell">
                        Example
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {FIELDS.map((row) => (
                      <tr key={row.field}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-subtle">
                          {row.field}
                        </td>
                        <td className="px-3 py-2 text-subtle">{row.meaning}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-muted sm:table-cell">
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
