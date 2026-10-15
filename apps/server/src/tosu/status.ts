export type TosuProbeResult = {
  httpUp: boolean;
  warnings: string[];
};

/** Probe tosu HTTP dashboard reachability. */
export async function probeTosuHttp(
  host: string,
  timeoutMs = 2_000,
): Promise<TosuProbeResult> {
  const warnings: string[] = [];
  const base = `http://${host}`;

  let httpUp = false;
  try {
    const res = await fetch(base, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    httpUp = res.ok || res.status < 500;
  } catch {
    httpUp = false;
  }

  if (!httpUp) {
    warnings.push(`Tosu is not reachable at ${host}.`);
    return { httpUp: false, warnings };
  }

  return { httpUp, warnings };
}
