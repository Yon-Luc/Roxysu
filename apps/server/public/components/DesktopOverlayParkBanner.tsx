import { useQuery } from "@tanstack/react-query";
import { fetchOverlayHostStatus } from "../lib/api";
import { isDesktopShell } from "../lib/desktop";
import { useAppDict } from "../lib/i18n";

/**
 * The In-game overlay park is otherwise only on Settings → Setup. In the
 * desktop shell, show it on every page so a GNOME park or a crash-loop is
 * not silent.
 */
export function DesktopOverlayParkBanner() {
  const { dict } = useAppDict();
  const desktop = isDesktopShell();
  const status = useQuery({
    queryKey: ["overlay-host-status"],
    queryFn: fetchOverlayHostStatus,
    enabled: desktop,
    refetchInterval: desktop ? 10_000 : false,
  });
  if (!desktop || status.isError || !status.data) return null;
  const parked = status.data.state === "parked" ? status.data.reason : null;
  const text =
    parked === "unsupported"
      ? (dict?.desktop?.overlayParkedUnsupported ??
        "Overlay unavailable on this desktop (no layer-shell)")
      : parked === "crash-loop"
        ? (dict?.desktop?.overlayParkedCrashes ??
          "Overlay stopped after repeated crashes — Restart")
        : null;
  if (!text) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-14 z-[100] -translate-x-1/2 rounded-lg border border-line bg-elevated px-4 py-2 text-sm font-medium text-ink shadow-lg"
    >
      {text}
    </div>
  );
}
