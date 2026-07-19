import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  findKeybindConflicts,
  formatKeyCode,
  getKeybinds,
  isModifierOnlyCode,
  resetKeybinds,
  resetKeymodeKeybinds,
  setColumnKeybind,
  useKeybinds,
} from "../lib/keybinds";
import { KEYMODES, type Keymode } from "../lib/previewSkin";

type KeybindModalProps = {
  open: boolean;
  onClose: () => void;
};

export function KeybindModal({ open, onClose }: KeybindModalProps) {
  if (!open) return null;
  return createPortal(
    <KeybindModalInner onClose={onClose} />,
    document.body,
  );
}

function KeybindModalInner({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const columnBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const binds = useKeybinds();
  const [keys, setKeys] = useState<Keymode>(7);
  const [capturing, setCapturing] = useState<number | null>(null);
  const [heldMask, setHeldMask] = useState(0);
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;

  const layout = binds[keys];
  const conflicts = findKeybindConflicts(layout);
  const conflictCols = new Set(conflicts.flat());

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (capturingRef.current != null) {
          setCapturing(null);
          return;
        }
        onClose();
        return;
      }

      const col = capturingRef.current;
      if (col != null) {
        e.preventDefault();
        e.stopPropagation();
        if (isModifierOnlyCode(e.code)) return;
        setColumnKeybind(keys, col, e.code);
        const next = col + 1;
        if (next < layout.length) {
          setCapturing(next);
          queueMicrotask(() => columnBtnRefs.current[next]?.focus());
        } else {
          setCapturing(null);
        }
        return;
      }

      const idx = layout.indexOf(e.code);
      if (idx >= 0) {
        e.preventDefault();
        setHeldMask((m) => m | (1 << idx));
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const idx = layout.indexOf(e.code);
      if (idx >= 0) {
        setHeldMask((m) => m & ~(1 << idx));
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [onClose, keys, layout]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[min(92vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-canvas shadow-2xl shadow-black/70 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-xl font-bold text-ink"
            >
              Keybinds
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Bind a key per column for map testing. Stored in this browser.
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

        <div className="flex flex-wrap gap-1 border-b border-white/10 px-4 py-2 sm:px-5">
          {KEYMODES.map((k) => (
            <button
              key={k}
              type="button"
              className={`rounded-lg px-2.5 py-1 text-sm font-semibold transition ${
                keys === k
                  ? "bg-accent-glow text-ink ring-1 ring-accent/50"
                  : "text-muted hover:bg-highlight hover:text-ink"
              }`}
              onClick={() => {
                setCapturing(null);
                setHeldMask(0);
                setKeys(k);
              }}
            >
              {k}K
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          <div className="mb-3 flex h-3 overflow-hidden rounded bg-elevated">
            {layout.map((_, i) => (
              <div
                key={i}
                className="h-full flex-1 border-r border-canvas/40 last:border-r-0 transition"
                style={{
                  background:
                    (heldMask & (1 << i)) !== 0
                      ? "var(--color-accent)"
                      : "transparent",
                }}
              />
            ))}
          </div>

          <ul className="space-y-2">
            {layout.map((code, i) => {
              const conflict = conflictCols.has(i);
              const active = capturing === i;
              return (
                <li
                  key={i}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                    conflict
                      ? "bg-rose-500/10 ring-1 ring-rose-400/40"
                      : "bg-elevated/50"
                  }`}
                >
                  <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-subtle">
                    Col {i + 1}
                  </span>
                  <button
                    type="button"
                    ref={(el) => {
                      columnBtnRefs.current[i] = el;
                    }}
                    className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left font-mono text-sm transition ${
                      active
                        ? "bg-accent-glow ring-1 ring-accent/60 text-ink"
                        : "bg-canvas/60 text-ink hover:bg-highlight"
                    }`}
                    onClick={() =>
                      setCapturing((c) => (c === i ? null : i))
                    }
                  >
                    {active ? "Press a key…" : formatKeyCode(code)}
                  </button>
                </li>
              );
            })}
          </ul>

          {conflicts.length > 0 ? (
            <p className="mt-3 text-sm text-rose-300/90">
              Duplicate keys on columns{" "}
              {conflicts
                .map((cols) => cols.map((c) => c + 1).join(" & "))
                .join("; ")}
              .
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3 sm:px-5">
          <button
            type="button"
            className="rx-btn"
            onClick={() => {
              setCapturing(null);
              resetKeymodeKeybinds(keys);
            }}
          >
            Reset {keys}K
          </button>
          <button
            type="button"
            className="rx-btn"
            onClick={() => {
              setCapturing(null);
              resetKeybinds();
              // Ensure UI reflects full reset even if cache was stale mid-render.
              void getKeybinds();
            }}
          >
            Reset all
          </button>
          <button
            type="button"
            className="rx-btn-primary ml-auto"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
