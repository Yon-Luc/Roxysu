import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  applyImportedManiaSkin,
  buildSampleManiaNotes,
  type ManiaSkinImportDraft,
} from "../lib/maniaSkinImport";
import { KEYMODES, type Keymode } from "../lib/previewSkin";
import { useAppDict, t } from "../lib/i18n";
import { ManiaNotefield } from "./ManiaNotefield";

export function ManiaSkinImportModal({
  draft,
  busy,
  error,
  onClose,
  onApplied,
}: {
  draft: ManiaSkinImportDraft;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { dict } = useAppDict();
  const defined = new Set(
    draft.definedKeys.filter((k): k is Keymode =>
      KEYMODES.includes(k as Keymode),
    ),
  );
  const defaultSelected =
    defined.size > 0 ? [...defined] : ([7] as Keymode[]);
  const [selected, setSelected] = useState<Keymode[]>(defaultSelected);
  const [previewKeys, setPreviewKeys] = useState<Keymode>(
    defaultSelected[0] ?? 7,
  );
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const timeRef = useRef(800);

  const pack = draft.packs[previewKeys];
  const sampleNotes = useMemo(
    () => buildSampleManiaNotes(previewKeys),
    [previewKeys],
  );

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !applying && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [applying, busy, onClose]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    function tick(now: number) {
      timeRef.current = (timeRef.current + (now - last)) % 7200;
      last = now;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function toggle(keys: Keymode) {
    setSelected((cur) =>
      cur.includes(keys) ? cur.filter((k) => k !== keys) : [...cur, keys],
    );
    setPreviewKeys(keys);
  }

  async function confirm() {
    if (selected.length === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      await applyImportedManiaSkin(draft, selected);
      onApplied?.();
      onClose();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/80 p-0 sm:items-center sm:p-3 md:p-5"
      onClick={() => {
        if (!applying && !busy) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none sm:h-[min(96vh,64rem)] sm:max-w-[min(96vw,80rem)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/5 px-5 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-bold text-ink">
              {dict?.skin.importTitle ?? "Import mania skin"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {t(dict?.skin.importSubtitle, { name: draft.name })}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rx-btn"
              disabled={applying || busy}
              onClick={onClose}
            >
              {dict?.skin.importCancel ?? "Cancel"}
            </button>
            <button
              type="button"
              className="rx-btn-primary"
              disabled={applying || busy || selected.length === 0}
              onClick={() => void confirm()}
            >
              {applying
                ? (dict?.skin.importApplying ?? "Saving…")
                : (dict?.skin.importConfirm ?? "Use this skin")}
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-3">
          {error ? (
            <p className="shrink-0 text-sm text-rose-300">{error}</p>
          ) : null}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {dict?.skin.importKeymodes ?? "Apply to keymodes"}
              </legend>
              <div className="flex flex-wrap gap-2">
                {KEYMODES.map((keys) => {
                  const on = selected.includes(keys);
                  const hasSection = defined.size === 0 || defined.has(keys);
                  return (
                    <label
                      key={keys}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm ${
                        on
                          ? "border-accent bg-accent/15 text-ink"
                          : "border-border text-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        checked={on}
                        onChange={() => toggle(keys)}
                      />
                      {keys}K
                      {!hasSection ? (
                        <span className="text-[10px] uppercase tracking-wide text-faint">
                          {dict?.skin.importFallback ?? "nearest"}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {dict?.skin.importPreview ?? "Preview"}
              </p>
              <div className="flex flex-wrap gap-1">
                {KEYMODES.map((keys) => (
                  <button
                    key={keys}
                    type="button"
                    className={
                      previewKeys === keys ? "rx-btn-primary text-xs" : "rx-btn text-xs"
                    }
                    onClick={() => setPreviewKeys(keys)}
                  >
                    {keys}K
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 justify-center">
            <div className="h-full w-full max-w-[min(100%,28rem)] overflow-hidden rounded-xl bg-black/80 sm:max-w-[min(55%,36rem)]">
              {pack ? (
                <ManiaNotefield
                  columnCount={previewKeys}
                  notes={sampleNotes}
                  skinOverride={{
                    shape: "flat",
                    columns: Array.from({ length: previewKeys }, () => ({
                      noteColor: "#a5b4fc",
                      lnColor: "#a5b4fc",
                      widthScale: 0.92,
                      heightScale: 1,
                      orientation: "down",
                      lnBodyScale: 0.6,
                    })),
                    uniformColors: false,
                    uniformWidth: false,
                    uniformSize: false,
                    columnSpacing: 0,
                    lnTailShape: "flat",
                    lnShowHead: true,
                    imported: pack.layout,
                  }}
                  spritesOverride={pack.sprites}
                  getCurrentTimeMs={() => timeRef.current}
                />
              ) : null}
            </div>
          </div>
          {applyError ? (
            <p className="shrink-0 text-sm text-rose-300">{applyError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
