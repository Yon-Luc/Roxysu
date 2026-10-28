import { spawn } from "node:child_process";

export type CsharpSkillOutput = {
  version: string;
  starRating: number;
  starRatingSs: number | null;
  attributes: Record<string, number>;
};

/** Run the pinned C# reference runner on one resolved `.osu` path. */
export function runCsharpReference(options: {
  dll: string;
  sha: string;
  beatmapPath: string;
  timeoutMs?: number;
}): Promise<CsharpSkillOutput> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "dotnet",
      ["exec", options.dll, "--sha", options.sha, options.beatmapPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (err: Error | null, value?: CsharpSkillOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(new Error("C# reference timed out"));
    }, timeoutMs);

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        err.code === "ENOENT"
          ? new Error("dotnet was not found on PATH")
          : err,
      );
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim();
        finish(new Error(detail || `C# reference exited ${code}`));
        return;
      }
      const lines = stdout
        .split("\n")
        .map((row) => row.trim())
        .filter((row) => row.startsWith("{"));
      const line = lines[lines.length - 1];
      if (!line) {
        finish(new Error("C# reference returned no JSON"));
        return;
      }
      try {
        const parsed = JSON.parse(line) as {
          version?: string;
          starRating?: number;
          starRatingSs?: number | null;
          attributes?: Record<string, number>;
        };
        if (typeof parsed.starRating !== "number") {
          finish(new Error("C# reference JSON missing starRating"));
          return;
        }
        finish(null, {
          version: parsed.version ?? options.sha,
          starRating: parsed.starRating,
          starRatingSs: parsed.starRatingSs ?? null,
          attributes: parsed.attributes ?? {},
        });
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}
