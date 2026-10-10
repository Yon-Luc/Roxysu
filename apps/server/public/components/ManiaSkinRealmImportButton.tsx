import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  fetchRealmSkinArchive,
  fetchRealmSkins,
  type RealmSkinListItem,
} from "../lib/api";
import {
  draftFromArchiveBytes,
  type ManiaSkinImportDraft,
} from "../lib/maniaSkinImport";
import { useAppDict } from "../lib/i18n";
import { ManiaSkinImportModal } from "./ManiaSkinImportModal";

export function ManiaSkinRealmImportButton({
  className = "rx-btn",
}: {
  className?: string;
}) {
  const { dict } = useAppDict();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<ManiaSkinImportDraft | null>(null);
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
        <RealmSkinPickerModal
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
        <ManiaSkinImportModal
          draft={draft}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
        />
      ) : null}
    </>
  );
}

function RealmSkinPickerModal({
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
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3"
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
        className="flex max-h-[min(90vh,36rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-canvas shadow-2xl shadow-black/70 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/5 px-5 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-bold text-ink">
              {dict?.skin.importFromGameTitle ?? "Import from game"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {dict?.skin.importFromGameSubtitle ??
                "Choose a legacy skin from your osu!lazer install."}
            </p>
          </div>
          <button
            type="button"
            className="rx-btn"
            disabled={busy}
            onClick={onClose}
          >
            {dict?.skin.importCancel ?? "Cancel"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-muted">
              {dict?.skin.importFromGameLoading ?? "Loading skins…"}
            </p>
          ) : null}
          {loadError ? (
            <div className="space-y-2">
              <p className="text-sm text-rose-300">{loadError}</p>
              <button type="button" className="rx-btn text-xs" onClick={load}>
                {dict?.skin.importFromGameRetry ?? "Retry"}
              </button>
            </div>
          ) : null}
          {!loading && !loadError && items && items.length === 0 ? (
            <p className="text-sm text-muted">
              {dict?.skin.importFromGameEmpty ??
                "No legacy skins with skin.ini found yet. Import a skin in osu!lazer, then wait for Roxysu sync (full/reconcile)."}
            </p>
          ) : null}
          {!loading && !loadError && items && items.length > 0 ? (
            <ul className="divide-y divide-white/5">
              {items.map((skin) => (
                <li key={skin.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-2 py-2.5 text-left hover:bg-white/5 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => onSelect(skin)}
                  >
                    <span className="text-sm font-medium text-ink">
                      {skin.name}
                    </span>
                    {skin.creator ? (
                      <span className="text-xs text-muted">{skin.creator}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
