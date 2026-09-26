import { useEffect, useId, useRef } from "react";
import { t, useAppDict } from "../lib/i18n";

const GITHUB_URL = "https://github.com/Yon-Luc/Roxysu";

/**
 * Blocking notice when osu!lazer's Realm schema is newer than this build.
 * No dismiss control: it stays until a matching Roxysu version opens Realm again.
 */
export function SchemaOutdatedDialog({
  mismatch,
}: {
  mismatch: { expected: number; actual: number } | null | undefined;
}) {
  const { dict } = useAppDict();
  const titleId = useId();
  const bodyId = useId();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const open = mismatch != null;

  useEffect(() => {
    if (!open) return;
    linkRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Tab") linkRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !mismatch) return null;

  const title = dict?.sync.schemaOutdated.title ?? "New version coming";
  const body =
    dict?.sync.schemaOutdated.body ??
    "A new version of Roxysu is coming to match the new osu!lazer schema. It will be available soon.";
  const github = dict?.sync.schemaOutdated.github ?? "Check GitHub for more info";
  const showVersions = mismatch.expected > 0 && mismatch.actual > 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-4 sm:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-md rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
      >
        <div className="border-b border-white/5 px-5 py-4">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">
            {title}
          </h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          <p id={bodyId} className="text-sm leading-relaxed text-muted">
            {body}
          </p>
          {showVersions ? (
            <p className="text-xs text-faint">
              {t(dict?.sync.schemaOutdated.versions, {
                expected: mismatch.expected,
                actual: mismatch.actual,
              }) ||
                `osu!lazer schema ${mismatch.actual} · this build expects ${mismatch.expected}`}
            </p>
          ) : null}
          <a
            ref={linkRef}
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rx-btn-primary inline-flex"
          >
            {github}
          </a>
        </div>
      </div>
    </div>
  );
}
