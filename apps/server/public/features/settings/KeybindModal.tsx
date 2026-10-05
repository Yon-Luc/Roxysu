import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ACTION_KEYBIND_IDS,
  type ActionKeybindId,
  findActionColumnOverlaps,
  findActionKeybindConflicts,
  findKeybindConflicts,
  formatKeyCode,
  getKeybinds,
  isModifierOnlyCode,
  resetActionKeybind,
  resetActionKeybinds,
  resetKeybinds,
  resetKeymodeKeybinds,
  setActionKeybindSlot,
  setColumnKeybind,
  useActionKeybinds,
  useKeybinds,
} from "../../lib/keybinds";
import { KEYMODES, type Keymode } from "../../lib/previewSkin";
import { useAppDict, t } from "../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";

export type KeybindModalTab = "columns" | "actions";

type KeybindModalProps = {
  open: boolean;
  onClose: () => void;
  initialTab?: KeybindModalTab;
};

export function KeybindModal({
  open,
  onClose,
  initialTab = "columns",
}: KeybindModalProps) {
  const { dict } = useAppDict();
  if (!open) return null;
  return createPortal(
    <KeybindModalInner
      onClose={onClose}
      dict={dict}
      initialTab={initialTab}
    />,
    document.body,
  );
}

function KeybindModalInner({
  onClose,
  dict,
  initialTab,
}: {
  onClose: () => void;
  dict: Dictionary["app"] | undefined;
  initialTab: KeybindModalTab;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const columnBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const binds = useKeybinds();
  const actionBinds = useActionKeybinds();
  const [tab, setTab] = useState<KeybindModalTab>(initialTab);
  const [keys, setKeys] = useState<Keymode>(7);
  const [capturing, setCapturing] = useState<number | null>(null);
  const [capturingAction, setCapturingAction] = useState<{
    id: ActionKeybindId;
    slot: 0 | 1;
  } | null>(null);
  const [heldMask, setHeldMask] = useState(0);
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const capturingActionRef = useRef(capturingAction);
  capturingActionRef.current = capturingAction;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const layoutRef = useRef(binds[keys]);
  layoutRef.current = binds[keys];

  const layout = binds[keys];
  const conflicts = findKeybindConflicts(layout);
  const conflictCols = new Set(conflicts.flat());
  const actionConflicts = findActionKeybindConflicts(actionBinds);
  const conflictActionIds = new Set(actionConflicts.flat());
  const columnOverlaps = findActionColumnOverlaps(actionBinds, layout);

  const km = dict?.settings.keybindsModal;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (capturingRef.current != null) {
          setCapturing(null);
          return;
        }
        if (capturingActionRef.current != null) {
          setCapturingAction(null);
          return;
        }
        onClose();
        return;
      }

      if (tabRef.current === "columns") {
        const col = capturingRef.current;
        if (col != null) {
          e.preventDefault();
          e.stopPropagation();
          if (isModifierOnlyCode(e.code)) return;
          const k = keysRef.current;
          const lay = layoutRef.current;
          setColumnKeybind(k, col, e.code);
          const next = col + 1;
          if (next < lay.length) {
            setCapturing(next);
            queueMicrotask(() => columnBtnRefs.current[next]?.focus());
          } else {
            setCapturing(null);
          }
          return;
        }

        const idx = layoutRef.current.indexOf(e.code);
        if (idx >= 0) {
          e.preventDefault();
          e.stopPropagation();
          setHeldMask((m) => m | (1 << idx));
        }
        return;
      }

      const cap = capturingActionRef.current;
      if (cap != null) {
        e.preventDefault();
        e.stopPropagation();
        if (isModifierOnlyCode(e.code)) return;
        setActionKeybindSlot(cap.id, cap.slot, e.code);
        if (cap.slot === 0) {
          setCapturingAction({ id: cap.id, slot: 1 });
        } else {
          setCapturingAction(null);
        }
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (tabRef.current !== "columns") return;
      const idx = layoutRef.current.indexOf(e.code);
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
  }, [onClose]);

  function switchTab(next: KeybindModalTab) {
    setCapturing(null);
    setCapturingAction(null);
    setHeldMask(0);
    setTab(next);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 sm:p-5"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[min(92vh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-canvas shadow-2xl shadow-black/70 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-xl font-bold text-ink"
            >
              {dict?.settings.keybinds}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{km?.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm text-muted transition hover:bg-highlight hover:text-ink"
            aria-label={km?.close}
          >
            Esc
          </button>
        </div>

        <div className="flex gap-1 border-b border-white/10 px-4 py-2 sm:px-5">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === "columns"
                ? "bg-accent-glow text-ink ring-1 ring-accent/50"
                : "text-muted hover:bg-highlight hover:text-ink"
            }`}
            onClick={() => switchTab("columns")}
          >
            {km?.tabColumns ?? "Columns"}
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === "actions"
                ? "bg-accent-glow text-ink ring-1 ring-accent/50"
                : "text-muted hover:bg-highlight hover:text-ink"
            }`}
            onClick={() => switchTab("actions")}
          >
            {km?.tabActions ?? "Actions"}
          </button>
        </div>

        {tab === "columns" ? (
          <>
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
                          ? "bg-danger/10 ring-1 ring-danger/40"
                          : "bg-elevated/50"
                      }`}
                    >
                      <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-subtle">
                        {t(km?.colPrefix, { n: i + 1 })}
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
                        {active ? km?.pressAKey : formatKeyCode(code)}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {conflicts.length > 0 ? (
                <p className="mt-3 text-sm text-danger/90">
                  {t(km?.duplicateKeys, {
                    cols: conflicts
                      .map((cols) => cols.map((c) => c + 1).join(" & "))
                      .join("; "),
                  })}
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
                {t(km?.resetKeymode, { keys })}
              </button>
              <button
                type="button"
                className="rx-btn"
                onClick={() => {
                  setCapturing(null);
                  resetKeybinds();
                  void getKeybinds();
                }}
              >
                {km?.resetAll}
              </button>
              <button
                type="button"
                className="rx-btn-primary ml-auto"
                onClick={onClose}
              >
                {km?.done}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              <p className="mb-3 text-xs text-muted">
                {km?.actionsHint ??
                  "Playback shortcuts for preview, play, and rewatch. Column keys still win in Play mode."}
              </p>
              <ul className="space-y-2">
                {ACTION_KEYBIND_IDS.map((id) => {
                  const codes = actionBinds[id];
                  const conflict = conflictActionIds.has(id);
                  const overlap = columnOverlaps.includes(id);
                  const label =
                    km?.actions?.[id] ??
                    id.replace(/([A-Z])/g, " $1").replace(/^./, (c) =>
                      c.toUpperCase(),
                    );
                  return (
                    <li
                      key={id}
                      className={`rounded-xl px-3 py-2 ${
                        conflict
                          ? "bg-danger/10 ring-1 ring-danger/40"
                          : "bg-elevated/50"
                      }`}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {label}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-muted hover:text-ink"
                          onClick={() => {
                            setCapturingAction(null);
                            resetActionKeybind(id);
                          }}
                        >
                          {km?.resetAction ?? "Reset"}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        {([0, 1] as const).map((slot) => {
                          const active =
                            capturingAction?.id === id &&
                            capturingAction.slot === slot;
                          const code = codes[slot];
                          return (
                            <button
                              key={slot}
                              type="button"
                              className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left font-mono text-sm transition ${
                                active
                                  ? "bg-accent-glow ring-1 ring-accent/60 text-ink"
                                  : code
                                    ? "bg-canvas/60 text-ink hover:bg-highlight"
                                    : "bg-canvas/40 text-muted hover:bg-highlight"
                              }`}
                              onClick={() =>
                                setCapturingAction((c) =>
                                  c?.id === id && c.slot === slot
                                    ? null
                                    : { id, slot },
                                )
                              }
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (slot === 1 || codes.length > 1) {
                                  setActionKeybindSlot(id, slot, null);
                                }
                              }}
                            >
                              {active
                                ? km?.pressAKey
                                : code
                                  ? formatKeyCode(code)
                                  : (km?.emptySlot ?? "—")}
                            </button>
                          );
                        })}
                      </div>
                      {overlap ? (
                        <p className="mt-1 text-[11px] text-amber-200/80">
                          {km?.columnOverlap ??
                            "Overlaps a column key — columns win in Play."}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {actionConflicts.length > 0 ? (
                <p className="mt-3 text-sm text-danger/90">
                  {t(km?.duplicateActions, {
                    actions: actionConflicts
                      .map((ids) =>
                        ids
                          .map(
                            (id) =>
                              km?.actions?.[id] ?? id,
                          )
                          .join(" & "),
                      )
                      .join("; "),
                  })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3 sm:px-5">
              <button
                type="button"
                className="rx-btn"
                onClick={() => {
                  setCapturingAction(null);
                  resetActionKeybinds();
                }}
              >
                {km?.resetAllActions ?? "Reset all actions"}
              </button>
              <button
                type="button"
                className="rx-btn-primary ml-auto"
                onClick={onClose}
              >
                {km?.done}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
