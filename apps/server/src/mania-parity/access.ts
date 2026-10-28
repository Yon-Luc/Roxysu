import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@roxysu/db/types";
import {
  getMostCommonUsernameSync,
  resolveScoresUsernamesSync,
} from "../analytics/scoreUsername";
import { resolveHubBaseUrl } from "../hubUrl";

/** Hub / local-library username that may open the dev compare page. */
export const DEV_OPERATOR = "noy";

export type ParityReason = "dev-folder" | "operator";

export type ParityPreset = {
  id: string;
  label: string;
  query: string;
};

export const PARITY_PRESETS: ParityPreset[] = [
  {
    id: "7k-ln-tech",
    label: "7K LN Dan Tech",
    query: 'mode:mania key=7 title:"7K LN Dan Tech Practice"',
  },
  {
    id: "7k-ln-release",
    label: "7K LN Dan Release",
    query: 'mode:mania key=7 title:"7K LN Dan Release Practice"',
  },
  {
    id: "7k-ln-inverse",
    label: "7K LN Dan Inverse",
    query: 'mode:mania key=7 title:"7K LN Dan Inverse Practice"',
  },
  {
    id: "7k-ln-general",
    label: "7K LN Dan General",
    query: 'mode:mania key=7 title:"7K LN Dan General Practice"',
  },
];

const PACKAGE_MARK = path.join(
  "packages",
  "mania-difficulty",
  "upstream",
  "revision.json",
);

export function isDevOperator(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === DEV_OPERATOR;
}

/** Walk up from a start path until the mania-difficulty pin file is found. */
export function findRepoRootFrom(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, PACKAGE_MARK))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function findManiaDevRoot(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return findRepoRootFrom(here) ?? findRepoRootFrom(process.cwd());
}

export function referenceRunnerDll(repoRoot: string): string | null {
  const bin = path.join(
    repoRoot,
    "packages",
    "mania-difficulty",
    "tools",
    "ReferenceRunner",
    "bin",
  );
  const candidates = ["Debug", "Release"]
    .map((config) => path.join(bin, config, "net8.0", "mania-difficulty-ref.dll"))
    .filter((file) => existsSync(file));
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
  )[0]!;
}

export function pinnedUpstreamSha(repoRoot: string): string | null {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(repoRoot, PACKAGE_MARK), "utf8"),
    ) as { sha?: string };
    return typeof raw.sha === "string" && raw.sha.length > 0 ? raw.sha : null;
  } catch {
    return null;
  }
}

/** Local library player is Noy (score-username filter, or the most common name). */
export function localOperatorIsDev(db: Db): boolean {
  const resolved = resolveScoresUsernamesSync(db);
  if (resolved?.some(isDevOperator)) return true;
  if (resolved == null && isDevOperator(getMostCommonUsernameSync(db))) {
    return true;
  }
  return false;
}

export type LocalParityAccess = {
  enabled: boolean;
  reason: ParityReason | null;
  repoRoot: string | null;
  sha: string | null;
  csharpDll: string | null;
  csharpReady: boolean;
};

export function localParityAccess(db: Db): LocalParityAccess {
  const repoRoot = findManiaDevRoot();
  const sha = repoRoot ? pinnedUpstreamSha(repoRoot) : null;
  const csharpDll = repoRoot ? referenceRunnerDll(repoRoot) : null;
  const devFolder = repoRoot != null;
  const operator = localOperatorIsDev(db);
  const reason: ParityReason | null = devFolder
    ? "dev-folder"
    : operator
      ? "operator"
      : null;
  return {
    enabled: reason != null,
    reason,
    repoRoot,
    sha,
    csharpDll,
    csharpReady: csharpDll != null && sha != null,
  };
}

const hubCache = new Map<string, { ok: boolean; at: number }>();
const HUB_CACHE_MS = 5 * 60 * 1000;

/** True when the Hub bearer belongs to the dev operator. Failures are not cached. */
export async function hubBearerIsOperator(
  authorization: string | undefined,
): Promise<boolean> {
  const token = authorization?.match(/^Bearer\s+(\S+)/i)?.[1];
  if (!token) return false;
  const hit = hubCache.get(token);
  if (hit && Date.now() - hit.at < HUB_CACHE_MS) return hit.ok;
  try {
    const base = resolveHubBaseUrl().replace(/\/$/, "");
    const res = await fetch(`${base}/auth/me`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { username?: string };
    const ok = isDevOperator(body.username);
    hubCache.set(token, { ok, at: Date.now() });
    return ok;
  } catch {
    return false;
  }
}

export async function parityAccess(
  db: Db,
  authorization?: string,
): Promise<LocalParityAccess> {
  const local = localParityAccess(db);
  if (local.enabled) return local;
  if (await hubBearerIsOperator(authorization)) {
    return { ...local, enabled: true, reason: "operator" };
  }
  return local;
}
