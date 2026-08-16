import { useCallback, useState, type DragEvent, type ReactNode } from "react";
import {
  draftFromDataTransfer,
  draftFromFileList,
  type ManiaSkinImportDraft,
} from "../lib/maniaSkinImport";
import { useAppDict } from "../lib/i18n";
import { ManiaSkinImportModal } from "./ManiaSkinImportModal";

export function ManiaSkinDropHost({
  children,
  className = "",
  enabled = true,
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  const { dict } = useAppDict();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ManiaSkinImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasSkinPayload = useCallback((dt: DataTransfer | null) => {
    if (!dt) return false;
    if ([...dt.types].includes("Files")) return true;
    return dt.files.length > 0;
  }, []);

  const ingest = useCallback(async (work: () => Promise<ManiaSkinImportDraft>) => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  function onDragOver(e: DragEvent) {
    if (!enabled || !hasSkinPayload(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  function onDrop(e: DragEvent) {
    if (!enabled || !hasSkinPayload(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dt = e.dataTransfer;
    void ingest(() => draftFromDataTransfer(dt));
  }

  return (
    <div
      className={`relative ${className}`}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {enabled && (dragOver || busy) ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-black/55 text-sm font-semibold text-ink">
          {busy
            ? (dict?.skin.importReading ?? "Reading skin…")
            : (dict?.skin.importDropHint ?? "Drop .osk or skin folder")}
        </div>
      ) : null}
      {error && !draft ? (
        <p className="mt-2 text-sm text-rose-300">{error}</p>
      ) : null}
      {draft ? (
        <ManiaSkinImportModal
          draft={draft}
          busy={busy}
          error={error}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function ManiaSkinFileButton({
  className = "rx-btn",
}: {
  className?: string;
}) {
  const { dict } = useAppDict();
  const [draft, setDraft] = useState<ManiaSkinImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <label className={`${className} cursor-pointer`}>
        <input
          type="file"
          accept=".osk,.zip,skin.ini"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const files = e.currentTarget.files;
            e.currentTarget.value = "";
            if (!files || files.length === 0) return;
            setBusy(true);
            setError(null);
            void draftFromFileList(files)
              .then(setDraft)
              .catch((err) => {
                setError(err instanceof Error ? err.message : String(err));
              })
              .finally(() => setBusy(false));
          }}
        />
        {busy
          ? (dict?.skin.importReading ?? "Reading skin…")
          : (dict?.skin.importButton ?? "Import .osk")}
      </label>
      {error && !draft ? (
        <span className="text-sm text-rose-300">{error}</span>
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
