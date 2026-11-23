/**
 * Parent lifeline (desktop DD-1). The Electron shell spawns this process with a
 * stdin *pipe* and sets ROXYSU_PARENT_LIFELINE=1. When the shell exits — cleanly
 * or not (crash, OOM, kill -9) — the OS closes its end of the pipe and stdin
 * reaches EOF, so the process shuts down instead of staying behind as an orphan
 * that holds the port and the local mirror. The shell also closes stdin on
 * purpose as its graceful stop signal (Windows has no SIGTERM, DD-4).
 *
 * Not a protocol: nothing is ever read from the pipe. Standalone runs (no env
 * flag, or an interactive TTY) are untouched.
 */

export interface LifelineStdin {
  isTTY?: boolean;
  on(event: "end" | "close" | "error", listener: () => void): unknown;
  resume(): unknown;
}

export function attachParentLifeline(
  onParentGone: (reason: string) => void,
  options: { env?: Record<string, string | undefined>; stdin?: LifelineStdin } = {},
): boolean {
  const env = options.env ?? process.env;
  if (env.ROXYSU_PARENT_LIFELINE !== "1") return false;
  const stdin = options.stdin ?? (process.stdin as unknown as LifelineStdin);
  if (stdin.isTTY) return false;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    onParentGone("parent-exit");
  };
  stdin.on("end", fire);
  stdin.on("close", fire);
  stdin.on("error", fire);
  stdin.resume();
  return true;
}
