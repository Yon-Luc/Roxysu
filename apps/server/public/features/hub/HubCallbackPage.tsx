import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  redeemHubHandoff,
  setHubJwt,
  useHubUrl,
} from "../../lib/hub";

/** Captures hub OAuth handoff from the hash query and routes to /hub. */
export function HubCallbackPage() {
  const navigate = useNavigate();
  const hubUrl = useHubUrl();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const handoff = params.get("h");
    // Legacy: older hubs put the JWT in the hash — accept once then clear.
    const legacyToken = params.get("token");

    void (async () => {
      try {
        if (handoff) {
          const token = await redeemHubHandoff(hubUrl, handoff);
          setHubJwt(token);
        } else if (legacyToken) {
          setHubJwt(legacyToken);
        }
        void navigate({ to: "/hub", replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign-in failed");
      }
    })();
  }, [hubUrl, navigate]);

  return (
    <div className="space-y-2 p-6">
      <p className="text-sm text-muted">
        {error ? error : "Signing in to Workshop…"}
      </p>
    </div>
  );
}
