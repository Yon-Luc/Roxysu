import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  fetchRealmSkinArchive,
  fetchRealmSkins,
  type RealmSkinListItem,
} from "../lib/api";
import { useAppDict } from "../lib/i18n";
import {
  applyImportedStdSkin,
  draftFromArchiveBytes,
  draftFromDroppedFiles,
  type StdSkinImportDraft,
} from "../lib/stdSkinImport";
import { StdPlayfield } from "./StdPlayfield";
import type { StdHitObject, StdPlayfieldJudgment } from "./StdPlayfield";

const DEMO: StdHitObject[] = [
  {
    type: "circle",
    x: 128,
    y: 192,
    timeMs: 800,
    stackX: 128,
    stackY: 192,
    newCombo: true,
  },
  {
    type: "circle",
    x: 256,
    y: 128,
    timeMs: 1100,
    stackX: 256,
    stackY: 128,
  },
  {
    type: "slider",
    x: 96,
    y: 256,
    timeMs: 1500,
    endMs: 2800,
    repeats: 2,
    pixelLength: 200,
    stackX: 96,
    stackY: 256,
    newCombo: true,
    path: Array.from({ length: 13 }, (_, i) => ({
      x: 96 + i * 24,
      y: 256 - Math.sin(i / 4) * 40,
    })),
    ticks: [
      { frac: 0.33, tMs: 1700 },
      { frac: 0.66, tMs: 1900 },
    ],
  },
];

const DEMO_JUDGMENTS: StdPlayfieldJudgment[] = DEMO.flatMap((obj, noteIndex) => {
  if (obj.type === "circle") {
    return [{ noteIndex, tMs: obj.timeMs, result: "great" as const }];
  }
  if (obj.type === "slider") {
    return [
      { noteIndex, tMs: obj.timeMs, result: "great" as const, kind: "head" as const },
      ...obj.ticks.map((tick) => ({
        noteIndex,
        tMs: tick.tMs,
        result: "great" as const,
        kind: "tick" as const,
        frac: tick.frac,
      })),
      { noteIndex, tMs: obj.endMs, result: "great" as const, kind: "tail" as const },
    ];
  }
  return [];
});

export function StdSkinImportModal({
  draft,
  busy,
  onClose,
  onApplied,
}: {
  draft: StdSkinImportDraft;
  busy?: boolean;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { dict } = useAppDict();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const timeRef = useRef(600);

  useEffect(() => {
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
    };
  }, [applying, busy, onClose]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    function tick(now: number) {
      timeRef.current = (timeRef.current + (now - last)) % 4000;
      last = now;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function confirm() {
    setApplying(true);
    setApplyError(null);
    try {
      await applyImportedStdSkin(draft);
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
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-auto rounded-none bg-canvas p-4 shadow-xl outline-none sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id={titleId} className="text-lg font-bold text-ink">
            {dict?.skin.importTitle ?? "Import standard skin"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {draft.name}
            {draft.colours.comboColors.length > 0
              ? ` · ${draft.colours.comboColors.length} combo colours`
              : ""}
          </p>
        </div>

        <div className="h-64 overflow-hidden rounded-xl bg-black/50">
          <StdPlayfield
            hitObjects={DEMO}
            circleSize={4}
            approachRate={7}
            getCurrentTimeMs={() => timeRef.current}
            judgments={DEMO_JUDGMENTS}
            sprites={draft.sprites}
          />
        </div>

        {applyError ? (
          <p className="text-sm text-rose-300">{applyError}</p>
        ) : null}

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
            disabled={applying || busy}
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

export function StdSkinFileButton({
  className = "rx-btn text-xs",
  onApplied,
}: {
  className?: string;
  onApplied?: () => void;
}) {
  const { dict } = useAppDict();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<StdSkinImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy
          ? (dict?.skin.importReading ?? "Reading skin…")
          : (dict?.skin.importButton ?? "Import .osk")}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".osk,.zip"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (files.length === 0) return;
          setBusy(true);
          setError(null);
          void draftFromDroppedFiles(files)
            .then(setDraft)
            .catch((err) => {
              setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => setBusy(false));
        }}
      />
      {error && !draft ? (
        <span className="text-sm text-rose-300">{error}</span>
      ) : null}
      {draft ? (
        <StdSkinImportModal
          draft={draft}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
          onApplied={onApplied}
        />
      ) : null}
    </>
  );
}

export function StdSkinRealmImportButton({
  className = "rx-btn text-xs",
  onApplied,
}: {
  className?: string;
  onApplied?: () => void;
}) {
  const { dict } = useAppDict();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<StdSkinImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => {
          setError(null);
          setPickerOpen(true);
        }}
      >
        {busy
          ? (dict?.skin.importReading ?? "Reading skin…")
          : (dict?.skin.importFromGame ?? "Import from game")}
      </button>
      {error && !draft && !pickerOpen ? (
        <span className="text-sm text-rose-300">{error}</span>
      ) : null}
      {pickerOpen ? (
        <StdRealmSkinPickerModal
          busy={busy}
          onClose={() => setPickerOpen(false)}
          onSelect={(skin) => {
            setPickerOpen(false);
            setBusy(true);
            setError(null);
            void fetchRealmSkinArchive(skin.id)
              .then((bytes) => draftFromArchiveBytes(bytes, skin.name))
              .then(setDraft)
              .catch((err) => {
                setError(err instanceof Error ? err.message : String(err));
              })
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
      {draft ? (
        <StdSkinImportModal
          draft={draft}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
          onApplied={onApplied}
        />
      ) : null}
    </>
  );
}

function StdRealmSkinPickerModal({
  busy,
  onClose,
  onSelect,
}: {
  busy: boolean;
  onClose: () => void;
  onSelect: (skin: RealmSkinListItem) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { dict } = useAppDict();
  const [items, setItems] = useState<RealmSkinListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void fetchRealmSkins()
      .then((res) => setItems(res.items))
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setItems(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-hidden rounded-2xl bg-canvas p-4 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-bold text-ink">
          {dict?.skin.importFromGame ?? "Import from game"}
        </h2>
        {loading ? (
          <p className="text-sm text-muted">
            {dict?.skin.importReading ?? "Reading skin…"}
          </p>
        ) : loadError ? (
          <div className="space-y-2">
            <p className="text-sm text-rose-300">{loadError}</p>
            <button type="button" className="rx-btn text-xs" onClick={load}>
              {dict?.skin.importFromGame ?? "Retry"}
            </button>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
            {(items ?? []).map((skin) => (
              <li key={skin.id}>
                <button
                  type="button"
                  className="rx-btn w-full justify-start text-left text-sm"
                  disabled={busy}
                  onClick={() => onSelect(skin)}
                >
                  {skin.name}
                </button>
              </li>
            ))}
            {(items ?? []).length === 0 ? (
              <li className="text-sm text-muted">
                {dict?.skin.importFromGameEmpty ??
                  "No importable skins found."}
              </li>
            ) : null}
          </ul>
        )}
        <div className="flex justify-end">
          <button type="button" className="rx-btn" onClick={onClose}>
            {dict?.skin.importCancel ?? "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
