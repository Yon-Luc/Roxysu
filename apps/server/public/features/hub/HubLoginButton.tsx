import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isDesktopShell } from "../../lib/desktop";
import {
  beginHubOAuthHandoff,
  hubLoginUrl,
  pollHubOAuthPending,
  setHubJwt,
  useHubUrl,
} from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";

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
  children,
}: HubLoginButtonProps) {
  const hubUrl = useHubUrl();
  const queryClient = useQueryClient();
  const desktop = isDesktopShell();
  const [waiting, setWaiting] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { dict } = useAppDict();
  const label = children ?? (dict?.hub?.loginButtonLabel ?? "Log in with osu!");

  useEffect(() => {
    if (!waiting || !handoff) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const token = await pollHubOAuthPending(handoff, ac.signal);
        setHubJwt(token);
        setWaiting(false);
        setHandoff(null);
        setError(null);
        void queryClient.invalidateQueries({ queryKey: ["hub-me"] });
        void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
        void queryClient.invalidateQueries({ queryKey: ["hub-collection"] });
      } catch (err) {
        if (ac.signal.aborted) return;
        setWaiting(false);
        setHandoff(null);
        setError(err instanceof Error ? err.message : (dict?.hub?.loginFailed ?? "Login failed"));
      }
    })();
    return () => ac.abort();
  }, [waiting, handoff, queryClient, dict]);

  if (!desktop) {
    return (
      <a href={hubLoginUrl(hubUrl)} className={className}>
        {label}
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
            setError(dict?.hub?.loginDesktopBridge ?? "Desktop bridge unavailable");
            return;
          }
          void (async () => {
            try {
              const id = await beginHubOAuthHandoff();
              await open(
                hubLoginUrl(hubUrl, { client: "desktop", handoff: id }),
              );
              setHandoff(id);
              setWaiting(true);
            } catch (err: unknown) {
              setError(
                err instanceof Error ? err.message : (dict?.hub?.loginOpenBrowser ?? "Could not open browser"),
              );
            }
          })();
        }}
      >
        {waiting ? (dict?.hub?.loginWaitingBrowser ?? "Waiting for browser…") : label}
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
