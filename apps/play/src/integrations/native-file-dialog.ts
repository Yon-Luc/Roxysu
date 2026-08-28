import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type SkinArchivePickResult = {
  path: string | null;
  error: string | null;
};

function trimOutput(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function commandAvailable(command: string): boolean {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

async function runCommand(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function pickWithZenity(title: string): Promise<string | null> {
  const { code, stdout } = await runCommand([
    "zenity",
    "--file-selection",
    `--title=${title}`,
    "--file-filter=osu! skin (*.osk) | *.osk",
    "--file-filter=All files | *",
  ]);
  return code === 0 ? trimOutput(stdout) : null;
}

async function pickWithKdialog(title: string): Promise<string | null> {
  const { code, stdout } = await runCommand([
    "kdialog",
    "--getopenfilename",
    ".",
    "*.osk|osu! skin",
    "*|All files",
  ]);
  return code === 0 ? trimOutput(stdout) : null;
}

async function pickWithOsascript(title: string): Promise<string | null> {
  const { code, stdout } = await runCommand([
    "osascript",
    "-e",
    `POSIX path of (choose file with prompt "${title}" of type {"osk", "OSK"})`,
  ]);
  const picked = trimOutput(stdout)?.replace(/\/$/, "") ?? null;
  return code === 0 ? picked : null;
}

async function pickWithPowerShell(title: string): Promise<string | null> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    `$dialog.Title = '${title.replace(/'/g, "''")}'`,
    '$dialog.Filter = "osu! skin (*.osk)|*.osk|All files (*.*)|*.*"',
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.FileName",
    "}",
  ].join("; ");

  const { code, stdout } = await runCommand([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  return code === 0 ? trimOutput(stdout) : null;
}

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return decodeURIComponent(uri.replace(/^file:\/\//, ""));
  }
}

function parsePortalResponse(output: string): string | null {
  if (!/Response\s*\(\s*uint32\s+0\b/.test(output)) {
    return null;
  }

  const match = output.match(/['"](file:\/\/[^'"]+)['"]/);
  return match ? uriToPath(match[1]!) : null;
}

async function pickWithDesktopPortal(
  title: string,
): Promise<SkinArchivePickResult> {
  if (!commandAvailable("gdbus")) {
    return { path: null, error: null };
  }

  const token = `roxysu${Date.now()}`;
  const options = `{"handle_token": <"${token}">, "multiple": <false>, "filters": <[("osu skin", [(uint32 0, "*.osk")])]>}`;

  const open = await runCommand([
    "gdbus",
    "call",
    "--session",
    "--dest",
    "org.freedesktop.portal.Desktop",
    "--object-path",
    "/org/freedesktop/portal/desktop",
    "--method",
    "org.freedesktop.portal.FileChooser.OpenFile",
    "",
    title,
    options,
  ]);

  if (open.code !== 0) {
    return {
      path: null,
      error:
        trimOutput(open.stderr) ?? "Desktop portal file chooser is unavailable.",
    };
  }

  const requestMatch = open.stdout.match(/objectpath\s+'([^']+)'/);
  const requestPath = requestMatch?.[1];
  if (!requestPath) {
    return { path: null, error: "Failed to start desktop file chooser." };
  }

  return new Promise((resolve) => {
    const child = Bun.spawn(
      [
        "gdbus",
        "monitor",
        "--session",
        "--dest",
        "org.freedesktop.portal.Desktop",
        "--object-path",
        requestPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    let output = "";
    let settled = false;

    const finish = (result: SkinArchivePickResult) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(result);
    };

    const onChunk = (chunk: Uint8Array) => {
      output += new TextDecoder().decode(chunk);
      if (output.includes("Response")) {
        finish({ path: parsePortalResponse(output), error: null });
      }
    };

    void (async () => {
      try {
        await Promise.all([
          child.stdout ? readStream(child.stdout, onChunk) : Promise.resolve(""),
          child.stderr ? readStream(child.stderr, onChunk) : Promise.resolve(""),
        ]);
        finish({ path: parsePortalResponse(output), error: null });
      } catch (error: unknown) {
        finish({
          path: null,
          error: error instanceof Error ? error.message : "File chooser failed.",
        });
      }
    })();
  });
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void,
): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    onChunk(value);
    text += new TextDecoder().decode(value);
  }
  return text;
}

async function pickSkinArchivePathImpl(
  title: string,
): Promise<SkinArchivePickResult> {
  if (process.platform === "darwin") {
    return { path: await pickWithOsascript(title), error: null };
  }

  if (process.platform === "win32") {
    return { path: await pickWithPowerShell(title), error: null };
  }

  if (commandAvailable("zenity")) {
    return { path: await pickWithZenity(title), error: null };
  }

  if (commandAvailable("kdialog")) {
    return { path: await pickWithKdialog(title), error: null };
  }

  const portal = await pickWithDesktopPortal(title);
  if (portal.path || portal.error) {
    return portal;
  }

  return {
    path: null,
    error:
      "No file picker is available. Install zenity, or paste a .osk path and click Apply.",
  };
}

/**
 * Opens a native file picker for `.osk` archives.
 * Deferred off the GPUIX click handler so subprocess dialogs can run reliably.
 */
export function pickSkinArchivePathAsync(
  title = "Import osu! skin (.osk)",
): Promise<SkinArchivePickResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      void pickSkinArchivePathImpl(title).then(resolve);
    }, 0);
  });
}
