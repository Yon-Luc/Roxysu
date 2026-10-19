import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { isDesktopShell } from "../../lib/desktop";
import {
  beginHubOAuthHandoff,
  hubLoginUrl,
  pollHubOAuthPending,
  prepareWebHubLoginChallenge,
  setHubJwt,
  useHubUrl,
} from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";

type HubLoginButtonProps = {
  className?: string;
  children?: ReactNode;
  title?: string;
};

/**
 * Bun/web: same-tab navigate to hub OAuth.
 * Electron: open system browser and poll localhost for the JWT handoff.
 */
export function HubLoginButton({
  className = "rx-btn-primary",
  children,
  title,
}: HubLoginButtonProps) {
  const hubUrl = useHubUrl();
  const queryClient = useQueryClient();
  const desktop = isDesktopShell();
  const [waiting, setWaiting] = useState(false);
  const [handoff, setHandoff] = useState<{
    id: string;
    verifier: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { dict } = useAppDict();
  const label = children ?? (dict?.hub?.loginButtonLabel ?? "Log in with osu!");

  const cancelWait = useCallback(() => {
    setWaiting(false);
    setHandoff(null);
  }, []);

  useEffect(() => {
    if (!waiting || !handoff) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const token = await pollHubOAuthPending(
          handoff.id,
          handoff.verifier,
          ac.signal,
        );
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
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          className={className}
          title={title}
          onClick={() => {
            setError(null);
            void (async () => {
              try {
                const challenge = await prepareWebHubLoginChallenge();
                window.location.assign(hubLoginUrl(hubUrl, { challenge }));
              } catch (err: unknown) {
                setError(
                  err instanceof Error
                    ? err.message
                    : (dict?.hub?.loginFailed ?? "Login failed"),
                );
              }
            })();
          }}
        >
          {label}
        </button>
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={className}
        title={title}
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
              const begin = await beginHubOAuthHandoff();
              await open(
                hubLoginUrl(hubUrl, {
                  client: "desktop",
                  nonce: begin.handoff,
                  challenge: begin.challenge,
                }),
              );
              setHandoff({ id: begin.handoff, verifier: begin.verifier });
              setWaiting(true);
            } catch (err: unknown) {
              setError(
                err instanceof Error ? err.message : (dict?.hub?.loginOpenBrowser ?? "Could not open browser"),
              );
            }
          })();
        }}
      >
        {label}
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      {waiting ? (
        <BrowserLoginModal
          message={
            dict?.hub?.loginBrowserPrompt ??
            "Go to your browser to finish the login."
          }
          cancelLabel={dict?.collection?.cancel ?? "Cancel"}
          onCancel={cancelWait}
        />
      ) : null}
    </span>
  );
}

function BrowserLoginModal({
  message,
  cancelLabel,
  onCancel,
}: {
  message: string;
  cancelLabel: string;
  onCancel: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="page-enter w-full max-w-xs rounded-2xl bg-elevated px-6 py-6 text-center shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mx-auto h-14 w-14" aria-hidden>
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
          <div className="absolute inset-2 animate-pulse rounded-full bg-accent/15" />
        </div>
        <p id={titleId} className="mt-5 text-sm font-semibold text-ink">
          {message}
        </p>
        <button type="button" className="rx-btn mt-5" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
