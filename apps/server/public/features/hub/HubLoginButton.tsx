import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isDesktopShell } from "../../lib/desktop";
import {
  hubLoginUrl,
  pollHubOAuthPending,
  setHubJwt,
  useHubUrl,
} from "../../lib/hub";

type HubLoginButtonProps = {
  className?: string;
  children?: ReactNode;
};

/**
 * Bun/web: same-tab navigate to hub OAuth.
 * Electron: open system browser and poll localhost for the JWT handoff.
 */
export function HubLoginButton({
  className = "rx-btn-primary",
  children = "Log in with osu!",
}: HubLoginButtonProps) {
  const hubUrl = useHubUrl();
  const queryClient = useQueryClient();
  const desktop = isDesktopShell();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const token = await pollHubOAuthPending(ac.signal);
        setHubJwt(token);
        setWaiting(false);
        setError(null);
        void queryClient.invalidateQueries({ queryKey: ["hub-me"] });
        void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
        void queryClient.invalidateQueries({ queryKey: ["hub-collection"] });
      } catch (err) {
        if (ac.signal.aborted) return;
        setWaiting(false);
        setError(err instanceof Error ? err.message : "Login failed");
      }
    })();
    return () => ac.abort();
  }, [waiting, queryClient]);

  if (!desktop) {
    return (
      <a href={hubLoginUrl(hubUrl)} className={className}>
        {children}
      </a>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={className}
        disabled={waiting || !window.roxysuDesktop?.openExternal}
        onClick={() => {
          setError(null);
          const open = window.roxysuDesktop?.openExternal;
          if (!open) {
            setError("Desktop bridge unavailable");
            return;
          }
          void open(hubLoginUrl(hubUrl, { client: "desktop" }))
            .then(() => setWaiting(true))
            .catch((err: unknown) => {
              setError(
                err instanceof Error ? err.message : "Could not open browser",
              );
            });
        }}
      >
        {waiting ? "Waiting for browser…" : children}
      </button>
      {error ? <span className="text-xs text-rose-300">{error}</span> : null}
    </span>
  );
}
