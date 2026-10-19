import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchSystemStatus } from "../../lib/api";
import { redeemHubHandoff, setHubJwt } from "../../lib/hub";
import { useAppDict } from "../../lib/i18n";

/** Captures hub OAuth handoff from the hash query and routes to /hub. */
export function HubCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { dict } = useAppDict();
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: fetchSystemStatus,
    staleTime: 60_000,
  });
  const started = useRef(false);

  useEffect(() => {
    if (!status.isSuccess || started.current) return;
    const hubUrl = status.data.hubUrl;
    if (!hubUrl) return;
    started.current = true;
    const handoff = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("h");

    void (async () => {
      try {
        if (handoff) {
          const token = await redeemHubHandoff(hubUrl, handoff);
          setHubJwt(token);
        }
        void navigate({ to: "/hub", replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : (dict?.hub?.callbackSignInFailed ?? "Sign-in failed"));
      }
    })();
  }, [status.isSuccess, status.data, navigate, dict]);

  return (
    <div className="space-y-2 p-6">
      <p className="text-sm text-muted">
        {error ? error : (dict?.hub?.callbackSigningIn ?? "Signing in to Community…")}
      </p>
    </div>
  );
}
