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
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-4 sm:items-center"
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
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/5 px-5 py-4">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">
            {dict?.skin.importTitle ?? "Import mania skin"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {t(dict?.skin.importSubtitle, { name: draft.name })}
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : null}
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">
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
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                {dict?.skin.importPreview ?? "Preview"}
              </h3>
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
            <div className="h-[22rem] overflow-hidden rounded-xl bg-black/40">
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
            <p className="text-sm text-rose-300">{applyError}</p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/5 px-5 py-4">
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
    </div>
  );
}
