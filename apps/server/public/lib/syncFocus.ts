/** OBS Browser Source (and preview) uses the hash overlay route. */
function isOverlayRoute(): boolean {
  const hash = window.location.hash.replace(/^#/, "");
  return hash === "/overlay" || hash.startsWith("/overlay?");
}

/**
 * Pause realm-reader while this tab is unfocused/hidden so opening client.realm
 * does not contend with osu!lazer score submission. Resumes on focus.
 *
 * Overlay tabs always report focused so an OBS Browser Source keeps syncing
 * while the streamer is in-game.
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

  const onPageHide = () => send(false);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    document.removeEventListener("visibilitychange", syncFromFocus);
    window.removeEventListener("focus", syncFromFocus);
    window.removeEventListener("blur", syncFromFocus);
    window.removeEventListener("hashchange", syncFromFocus);
    window.removeEventListener("pagehide", onPageHide);
    if (lastSent !== false) {
      lastSent = null;
      send(false);
    }
    disposed = true;
  };
}
