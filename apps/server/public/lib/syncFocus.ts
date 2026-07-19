/** OBS Browser Source (and preview) uses the hash overlay route. */
function isOverlayRoute(): boolean {
  const hash = window.location.hash.replace(/^#/, "");
  return hash === "/overlay" || hash.startsWith("/overlay?");
}

/**
 * Pause realm-reader while this tab is unfocused/hidden so opening client.realm
 * does not contend with osu!lazer score submission. Resumes on focus.
 *
 * Overlay tabs only ever resume sync (never pause): OBS CEF is usually
 * unfocused, and a blurred main Roxysu tab must not freeze imports while the
 * overlay is live. A short heartbeat re-asserts focus if another tab paused.
 */
export function connectSyncFocus(): () => void {
  let lastSent: boolean | null = null;
  let disposed = false;

  const send = (focused: boolean) => {
    if (disposed || lastSent === focused) return;
    lastSent = focused;

    void fetch("/api/system/sync-focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focused }),
      // Survives tab close / navigation better than a normal XHR.
      keepalive: true,
    }).catch(() => {
      // Allow retry on the next visibility/focus event.
      lastSent = null;
    });
  };

  const syncFromFocus = () => {
    if (isOverlayRoute()) {
      send(true);
      return;
    }
    send(document.visibilityState === "visible" && document.hasFocus());
  };

  syncFromFocus();
  document.addEventListener("visibilitychange", syncFromFocus);
  window.addEventListener("focus", syncFromFocus);
  window.addEventListener("blur", syncFromFocus);
  window.addEventListener("hashchange", syncFromFocus);

  // Overlay: never pause on hide/close — leave sync running for the stream.
  const onPageHide = () => {
    if (isOverlayRoute()) return;
    send(false);
  };
  window.addEventListener("pagehide", onPageHide);

  // Re-assert overlay focus in case another Roxysu tab paused sync.
  const heartbeat = window.setInterval(() => {
    if (!isOverlayRoute()) return;
    lastSent = null;
    send(true);
  }, 3_000);

  return () => {
    window.clearInterval(heartbeat);
    document.removeEventListener("visibilitychange", syncFromFocus);
    window.removeEventListener("focus", syncFromFocus);
    window.removeEventListener("blur", syncFromFocus);
    window.removeEventListener("hashchange", syncFromFocus);
    window.removeEventListener("pagehide", onPageHide);
    if (!isOverlayRoute() && lastSent !== false) {
      lastSent = null;
      send(false);
    }
    disposed = true;
  };
}
