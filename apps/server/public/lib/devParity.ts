import { useQuery } from "@tanstack/react-query";
import type {
  ParityReport,
  SkillKey,
} from "@server/mania-parity/compare";
import { fetchSystemStatus } from "./api";
import { fetchHubMe, useHubJwt, useHubUrl } from "./hub";

export type { ParityReport, SkillKey };

export type ManiaParityStatus = {
  enabled: boolean;
  reason: "dev-folder" | "operator" | null;
  sha: string | null;
  csharpReady: boolean;
  hint: string | null;
  presets: Array<{ id: string; label: string; query: string }>;
  limitDefault: number;
  limitMax: number;
};

function authHeaders(token: string | null): HeadersInit {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readError(res: Response, label: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? `${label} failed: HTTP ${res.status}`);
}

export async function fetchManiaParityStatus(
  token: string | null,
): Promise<ManiaParityStatus> {
  const res = await fetch("/api/dev/mania-parity/status", {
    headers: authHeaders(token),
  });
  if (!res.ok) await readError(res, "Parity status");
  return (await res.json()) as ManiaParityStatus;
}

export async function compareManiaParity(
  body: { query: string; limit: number },
  token: string | null,
): Promise<ParityReport> {
  const res = await fetch("/api/dev/mania-parity/compare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) await readError(res, "Parity compare");
  return (await res.json()) as ParityReport;
}

/** Nav visibility: local gate from system status, or a Hub session named Noy. */
export function useDevParityVisible(): boolean {
  const { data: status } = useQuery({
    queryKey: ["system", "status"],
    queryFn: fetchSystemStatus,
    staleTime: 30_000,
  });
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const me = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    enabled: Boolean(jwt),
    staleTime: 60_000,
  });
  const hubNoy = me.data?.username?.trim().toLowerCase() === "noy";
  return Boolean(status?.devParity) || hubNoy;
}
