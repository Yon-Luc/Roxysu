import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  fetchRealmSkinArchive,
  fetchRealmSkins,
  type RealmSkinListItem,
} from "../lib/api";
import { useAppDict } from "../lib/i18n";
import {
  applyImportedCatchSkin,
  draftFromArchiveBytes,
  draftFromDroppedFiles,
  type CatchSkinImportDraft,
} from "../lib/catchSkinImport";
import { defaultCatchSkin, type CatchSkin } from "../lib/catchSkin";
import { CatchPlayfield } from "./CatchPlayfield";
import type { CatchHitObject, CatchPlayfieldJudgment } from "./CatchPlayfield";

function skinFromDraft(draft: CatchSkinImportDraft): CatchSkin {
  const base = defaultCatchSkin();
  const c = draft.colours;
  const cc = draft.catchColours;
  const hyperDash = cc.hyperDash ?? base.hyperDash;
  return {
    ...base,
    comboColors: c.comboColors.length > 0 ? c.comboColors : base.comboColors,
    hyperDash,
    hyperDashFruit: cc.hyperDashFruit ?? hyperDash,
    hyperDashAfterImage: cc.hyperDashAfterImage ?? hyperDash,
    imported: {
      name: draft.name,
      colours: {
        comboColors: c.comboColors,
        hyperDash: cc.hyperDash,
        hyperDashFruit: cc.hyperDashFruit,
        hyperDashAfterImage: cc.hyperDashAfterImage,
      },
    },
  };
}

const DEMO_OBJECTS: CatchHitObject[] = [
  {
    type: "fruit",
    x: 80,
    timeMs: 700,
    hyperDash: false,
    newCombo: true,
    indexInBeatmap: 0,
  },
  {
    type: "fruit",
    x: 180,
    timeMs: 1000,
    hyperDash: false,
    indexInBeatmap: 1,
  },
  {
    type: "fruit",
    x: 280,
    timeMs: 1300,
    hyperDash: false,
    indexInBeatmap: 2,
  },
  {
    type: "fruit",
    x: 420,
    timeMs: 1600,
    hyperDash: true,
    newCombo: true,
    indexInBeatmap: 3,
  },
  { type: "droplet", x: 200, timeMs: 2000, kind: "tiny" },
  { type: "droplet", x: 240, timeMs: 2140, kind: "large" },
  {
    type: "fruit",
    x: 320,
    timeMs: 2500,
    hyperDash: false,
    indexInBeatmap: 4,
  },
  { type: "banana", x: 100, timeMs: 3400 },
  { type: "banana", x: 250, timeMs: 3520 },
  {
    type: "fruit",
    x: 256,
    timeMs: 4200,
    hyperDash: false,
    newCombo: true,
    indexInBeatmap: 5,
  },
];

const DEMO_JUDGMENTS: CatchPlayfieldJudgment[] = DEMO_OBJECTS.map(
  (obj, noteIndex) => ({
    noteIndex,
    tMs: obj.timeMs,
    result: obj.type === "banana" ? ("meh" as const) : ("great" as const),
    kind: obj.type,
  }),
);

export function CatchSkinImportModal({
  draft,
  busy,
  onClose,
  onApplied,
}: {
  draft: CatchSkinImportDraft;
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
      timeRef.current = (timeRef.current + (now - last)) % 5000;
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
      await applyImportedCatchSkin(draft);
      onApplied?.();
      onClose();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  const spriteCount = Object.keys(draft.blobs).length;

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
            {dict?.skin.importTitle ?? "Import catch skin"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {draft.name}
            {draft.colours.comboColors.length > 0
              ? ` · ${draft.colours.comboColors.length} combo colours`
              : ""}
            {spriteCount > 0 ? ` · ${spriteCount} sprites` : ""}
          </p>
        </div>

        <div className="h-64 overflow-hidden rounded-xl bg-black/50">
          <CatchPlayfield
            hitObjects={DEMO_OBJECTS}
            circleSize={4}
            approachRate={7}
            getCurrentTimeMs={() => timeRef.current}
            judgments={DEMO_JUDGMENTS}
            skin={skinFromDraft(draft)}
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

export function CatchSkinFileButton({
  className = "rx-btn text-xs",
  onApplied,
}: {
  className?: string;
  onApplied?: () => void;
}) {
  const { dict } = useAppDict();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<CatchSkinImportDraft | null>(null);
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
          ? (dict?.skin.importReading ?? "Reading…")
          : (dict?.skin.importButton ?? "Import .osk")}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".osk,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          void draftFromDroppedFiles([file])
            .then((d) => setDraft(d))
            .catch((err) =>
              setError(err instanceof Error ? err.message : String(err)),
            )
            .finally(() => setBusy(false));
        }}
      />
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      {draft ? (
        <CatchSkinImportModal
          draft={draft}
          busy={busy}
          onClose={() => setDraft(null)}
          onApplied={onApplied}
        />
      ) : null}
    </>
  );
}

export function CatchSkinRealmButton({
  className = "rx-btn text-xs",
  onApplied,
}: {
  className?: string;
  onApplied?: () => void;
}) {
  const { dict } = useAppDict();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<CatchSkinImportDraft | null>(null);
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
          ? (dict?.skin.importReading ?? "Reading…")
          : (dict?.skin.importFromGame ?? "Import from game")}
      </button>
      {error && !draft && !pickerOpen ? (
        <span className="text-sm text-rose-300">{error}</span>
      ) : null}
      {pickerOpen ? (
        <CatchRealmSkinPickerModal
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
        <CatchSkinImportModal
          draft={draft}
          busy={busy}
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

function CatchRealmSkinPickerModal({
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
            {dict?.skin.importReading ?? "Reading…"}
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
