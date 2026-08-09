import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { setHubJwt } from "../../lib/hub";

/** Captures hub OAuth JWT from the hash query and routes to /hub. */
export function HubCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const token = params.get("token");
    if (token) {
      setHubJwt(token);
    }
    void navigate({ to: "/hub", replace: true });
  }, [navigate]);

  return (
    <div className="space-y-2 p-6">
      <p className="text-sm text-muted">Signing in to Workshop…</p>
    </div>
  );
}
