import { useEffect, useState } from "react";
import type { DesktopServerState } from "../lib/desktop";
import { t, useAppDict } from "../lib/i18n";

/**
 * DD-6: when the Electron shell's local server dies mid-session, the shell
 * pushes its restart state through the preload bridge. Show it instead of
 * leaving the page with silent failed fetches. The shell reloads the page
 * (route kept) once the server is back, which also clears this banner.
 */
export function DesktopServerBanner() {
  const { dict } = useAppDict();
  const [state, setState] = useState<DesktopServerState | null>(null);

  useEffect(() => {
    const subscribe = window.roxysuDesktop?.onServerState;
    if (typeof subscribe !== "function") return;
    return subscribe((next) => setState(next));
  }, []);

  if (!state) return null;
  const text =
    state.state === "restarting"
      ? t(
          dict?.desktop?.serverRestarting ??
            "Local server stopped — restarting (attempt {{attempt}} of {{max}})…",
          { attempt: state.attempt, max: state.maxAttempts },
        )
      : (dict?.desktop?.serverBack ?? "Local server is back — reloading…");

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-[100] -translate-x-1/2 rounded-lg border border-line bg-elevated px-4 py-2 text-sm font-medium text-ink shadow-lg"
    >
      {text}
    </div>
  );
}
