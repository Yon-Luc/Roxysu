/**
 * Pause realm-reader while this tab is unfocused/hidden so opening client.realm
 * does not contend with osu!lazer score submission. Resumes on focus.
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
    send(document.visibilityState === "visible" && document.hasFocus());
  };

  syncFromFocus();
  document.addEventListener("visibilitychange", syncFromFocus);
  window.addEventListener("focus", syncFromFocus);
  window.addEventListener("blur", syncFromFocus);

  const onPageHide = () => send(false);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    document.removeEventListener("visibilitychange", syncFromFocus);
    window.removeEventListener("focus", syncFromFocus);
    window.removeEventListener("blur", syncFromFocus);
    window.removeEventListener("pagehide", onPageHide);
    if (lastSent !== false) {
      lastSent = null;
      send(false);
    }
    disposed = true;
  };
}
