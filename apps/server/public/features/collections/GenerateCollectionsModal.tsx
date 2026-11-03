import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DanTableKind } from "@roxysu/mania-difficulty";
import { QueryParseError, parseQuery } from "@server/query-language";
import { focusTrapTarget, listFocusable } from "../../lib/focusTrap";
import { useAppDict, t } from "../../lib/i18n";
import { createCollections } from "../../lib/api";
import {
  COLLECTION_BATCH_MAX,
  DEFAULT_ACCURACY_BANDS,
  DEFAULT_STAR_MAX,
  DEFAULT_STAR_MIN,
  DEFAULT_STAR_STEP,
  GENERATE_KEY_COUNTS,
  buildAccuracyCollections,
  buildDanCollections,
  buildStarCollections,
  danTiersFor,
  hasDistinctLnTable,
  type GenerateBuild,
  type GenerateKeyCount,
} from "./generateCollections";

type GenerateMode = "stars" | "accuracy" | "dans";

function readNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-fit max-w-full rounded-full bg-surface p-1"
    >
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            className={
              selected
                ? "rounded-full bg-elevated px-3 py-1.5 text-sm font-bold text-ink transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98]"
                : "rounded-full px-3 py-1.5 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] [@media(hover:hover)]:hover:text-ink"
            }
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function GenerateCollectionsModal({
  open,
  existingNames,
  onClose,
}: {
  open: boolean;
  existingNames: readonly string[];
  onClose: () => void;
}) {
  const { dict } = useAppDict();
  const queryClient = useQueryClient();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [present, setPresent] = useState(false);
  const [mode, setMode] = useState<GenerateMode>("stars");
  const [keyCount, setKeyCount] = useState<GenerateKeyCount>(7);
  const [tableKind, setTableKind] = useState<DanTableKind>("rice");
  const [starMin, setStarMin] = useState(String(DEFAULT_STAR_MIN));
  const [starMax, setStarMax] = useState(String(DEFAULT_STAR_MAX));
  const [starStep, setStarStep] = useState(String(DEFAULT_STAR_STEP));
  const [bands, setBands] = useState(DEFAULT_ACCURACY_BANDS);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extra, setExtra] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: createCollections,
    onSuccess: async (result) => {
      setMessage(
        t(dict?.collection.generateResult, {
          created: result.created,
          skipped: result.skipped,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });
  const busy = createMut.isPending;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) {
      setPresent(false);
      return;
    }
    const frame = requestAnimationFrame(() => setPresent(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const dialog = dialogRef.current;
        const focusables = listFocusable(dialog);
        const active = document.activeElement as HTMLElement | null;
        const target = focusTrapTarget(
          focusables,
          active === dialog ? null : active,
          e.shiftKey,
        );
        if (target) {
          e.preventDefault();
          target.focus();
        } else if (focusables.length === 0) {
          e.preventDefault();
          dialog.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [open]);

  const distinctLn = hasDistinctLnTable(keyCount);
  const kind: DanTableKind = distinctLn ? tableKind : "rice";
  const tiers = useMemo(() => danTiersFor(keyCount, kind), [keyCount, kind]);
  const selectedTiers = picked ?? tiers;

  useEffect(() => {
    setPicked(null);
  }, [keyCount, kind]);

  const existing = useMemo(() => new Set(existingNames), [existingNames]);

  const built: GenerateBuild = useMemo(() => {
    if (mode === "stars") {
      const min = readNumber(starMin);
      const max = readNumber(starMax);
      const step = readNumber(starStep);
      if (min == null || max == null || step == null) {
        return { ok: false, reason: "invalid" };
      }
      return buildStarCollections({ keyCount, min, max, step, extra });
    }
    if (mode === "accuracy") {
      return buildAccuracyCollections({ keyCount, bands, extra });
    }
    return buildDanCollections({
      keyCount,
      tiers: tiers.filter((tier) => selectedTiers.includes(tier)),
      extra,
    });
  }, [
    mode,
    keyCount,
    starMin,
    starMax,
    starStep,
    bands,
    extra,
    tiers,
    selectedTiers,
  ]);

  const parseError = useMemo(() => {
    if (!built.ok) return null;
    for (const item of built.items) {
      try {
        parseQuery(item.query);
      } catch (err) {
        return err instanceof QueryParseError ? err.message : "Invalid query";
      }
    }
    return null;
  }, [built]);

  const creatable =
    built.ok && parseError == null
      ? built.items.filter((item) => !existing.has(item.name))
      : [];

  function changeMode(next: GenerateMode) {
    setMode(next);
    setMessage(null);
    createMut.reset();
  }

  const modeHint =
    mode === "accuracy"
      ? dict?.collection.generateAccHint
      : dict?.collection.generateUnratedHint;

  const buildError =
    !built.ok && built.reason === "too-many"
      ? t(dict?.collection.generateTooMany, { max: COLLECTION_BATCH_MAX })
      : !built.ok
        ? mode === "accuracy"
          ? dict?.collection.generateInvalidBands
          : dict?.collection.generateInvalidRange
        : null;

  if (!open) return null;

  const title = dict?.collection.generateHeading ?? "Generate collections";
  const showExtra = extraOpen || extra.trim().length > 0;

  return (
    <div
      className="rx-dialog-scrim fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      data-open={present ? "true" : "false"}
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-open={present ? "true" : "false"}
        className="rx-dialog-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-2xl shadow-black/40 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-lg font-bold tracking-tight text-ink"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {dict?.collection.generateHint}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 rounded-full px-3 py-1 text-sm text-muted transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98] disabled:opacity-40 [@media(hover:hover)]:hover:bg-highlight [@media(hover:hover)]:hover:text-ink"
            aria-label={dict?.collection.cancel ?? "Close"}
          >
            Esc
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div
            role="tablist"
            aria-label={title}
            className="flex rounded-full bg-surface p-1"
          >
            {(
              [
                ["stars", dict?.collection.generateStars ?? "Rework stars"],
                ["accuracy", dict?.collection.generateAccuracy ?? "Accuracy"],
                ["dans", dict?.collection.generateDans ?? "Rework dans"],
              ] as const
            ).map(([id, label]) => {
              const selected = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={
                    selected
                      ? "min-w-0 flex-1 truncate rounded-full bg-elevated px-2 py-1.5 text-xs font-bold text-ink transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] sm:px-3 sm:text-sm"
                      : "min-w-0 flex-1 truncate rounded-full px-2 py-1.5 text-xs font-medium text-muted transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] sm:px-3 sm:text-sm [@media(hover:hover)]:hover:text-ink"
                  }
                  onClick={() => changeMode(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label={dict?.collection.generateKey ?? "Keys"}
              value={String(keyCount)}
              options={GENERATE_KEY_COUNTS.map((count) => ({
                id: String(count),
                label: `${count}K`,
              }))}
              onChange={(id) => setKeyCount(Number(id) as GenerateKeyCount)}
            />
            {distinctLn ? (
              <Segmented
                label={dict?.collection.generateLn ?? "LN"}
                value={kind}
                options={[
                  { id: "rice", label: dict?.collection.generateRice ?? "Rice" },
                  { id: "ln", label: dict?.collection.generateLn ?? "LN" },
                ]}
                onChange={setTableKind}
              />
            ) : null}
          </div>

          {mode === "stars" ? (
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  [dict?.collection.generateFrom ?? "From", starMin, setStarMin],
                  [dict?.collection.generateUpTo ?? "Up to", starMax, setStarMax],
                  [dict?.collection.generateStep ?? "Step", starStep, setStarStep],
                ] as const
              ).map(([label, value, setValue]) => (
                <label key={label} className="block space-y-1">
                  <span className="text-xs font-medium text-faint">{label}</span>
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    inputMode="decimal"
                    className="rx-input tabular-nums"
                  />
                </label>
              ))}
            </div>
          ) : null}

          {mode === "accuracy" ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-faint">
                {dict?.collection.generateBands ?? "Bands"}
              </span>
              <input
                value={bands}
                onChange={(e) => setBands(e.target.value)}
                placeholder={dict?.collection.generateBandsPlaceholder}
                className="rx-input"
              />
            </label>
          ) : null}

          {mode === "dans" ? (
            <div className="space-y-2">
              <div className="flex gap-3 text-xs font-medium">
                <button
                  type="button"
                  className="text-muted transition-colors duration-150 ease-out [@media(hover:hover)]:hover:text-ink"
                  onClick={() => setPicked(null)}
                >
                  {dict?.collection.generateSelectAll ?? "All"}
                </button>
                <button
                  type="button"
                  className="text-muted transition-colors duration-150 ease-out [@media(hover:hover)]:hover:text-ink"
                  onClick={() => setPicked([])}
                >
                  {dict?.collection.generateSelectNone ?? "None"}
                </button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {tiers.map((tier) => {
                  const checked = selectedTiers.includes(tier);
                  return (
                    <li key={tier}>
                      <label
                        className={
                          checked
                            ? "flex cursor-pointer items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-sm text-ink"
                            : "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setPicked((prev) => {
                              const current = new Set(prev ?? tiers);
                              if (current.has(tier)) current.delete(tier);
                              else current.add(tier);
                              return tiers.filter((name) => current.has(name));
                            });
                          }}
                          className="accent-[var(--color-accent)]"
                        />
                        {tier}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {showExtra ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-faint">
                {dict?.collection.generateExtra ?? "Extra query"}
              </span>
              <input
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder={dict?.collection.generateExtraPlaceholder ?? "ranked"}
                className="rx-input"
              />
            </label>
          ) : (
            <button
              type="button"
              className="text-xs font-medium text-muted transition-colors duration-150 ease-out [@media(hover:hover)]:hover:text-ink"
              onClick={() => setExtraOpen(true)}
            >
              {dict?.collection.generateExtra ?? "Extra query"}
            </button>
          )}

          {modeHint ? <p className="text-xs text-faint">{modeHint}</p> : null}
          {buildError ? <p className="text-sm text-danger">{buildError}</p> : null}
          {parseError ? <p className="text-sm text-danger">{parseError}</p> : null}

          {built.ok && built.items.length > 0 ? (
            <div className="overflow-hidden rounded-xl bg-surface">
              <div className="px-3 py-2 text-xs font-medium text-faint">
                {dict?.collection.generatePreview ?? "Preview"}
              </div>
              <ul className="grid border-t border-line sm:grid-cols-2">
                {built.items.map((item) => {
                  const exists = existing.has(item.name);
                  return (
                    <li
                      key={item.name}
                      className="border-b border-line px-3 py-2 sm:odd:border-r"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span
                          className={
                            exists
                              ? "truncate text-sm text-faint"
                              : "truncate text-sm font-medium text-ink"
                          }
                        >
                          {item.name}
                        </span>
                        {exists ? (
                          <span className="shrink-0 text-xs text-faint">
                            {dict?.collection.generateExists ?? "exists"}
                          </span>
                        ) : null}
                      </div>
                      <code className="mt-0.5 block truncate text-xs text-faint">
                        {item.query}
                      </code>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="mr-auto min-w-0 text-sm text-muted">
            {message ? (
              <span className="text-success">{message}</span>
            ) : createMut.error ? (
              <span className="text-danger">{createMut.error.message}</span>
            ) : creatable.length === 0 && built.ok && parseError == null ? (
              (dict?.collection.generateNone ?? "Nothing to create.")
            ) : null}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rx-btn"
              disabled={busy}
              onClick={onClose}
            >
              {dict?.collection.cancel ?? "Cancel"}
            </button>
            <button
              type="button"
              className="rx-btn-primary"
              disabled={busy || creatable.length === 0}
              onClick={() => {
                if (!built.ok) return;
                setMessage(null);
                createMut.mutate({ items: built.items });
              }}
            >
              {busy
                ? (dict?.collection.generateCreating ?? "Creating…")
                : dict?.collection.generateCreate
                  ? t(dict.collection.generateCreate, {
                      count: creatable.length,
                    })
                  : `Create ${creatable.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
