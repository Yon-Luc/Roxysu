export type TosuProbeResult = {
  httpUp: boolean;
  maniaMapAnalyserInstalled: boolean;
  warnings: string[];
};

/** Probe tosu HTTP dashboard and optional ManiaMapAnalyser static overlay. */
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
    return { httpUp: false, maniaMapAnalyserInstalled: false, warnings };
  }

  let maniaMapAnalyserInstalled = false;
  try {
    const res = await fetch(`${base}/ManiaMapAnalyser/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    maniaMapAnalyserInstalled = res.ok;
  } catch {
    maniaMapAnalyserInstalled = false;
  }

  if (!maniaMapAnalyserInstalled) {
    warnings.push(
      "ManiaMapAnalyser overlay not found under tosu static (http://…/ManiaMapAnalyser/). Install it for the in-game overlay; Roxysu still analyzes maps itself.",
    );
  }

  return { httpUp, maniaMapAnalyserInstalled, warnings };
}
