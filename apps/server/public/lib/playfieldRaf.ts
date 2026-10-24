export function resizePlayfieldCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  onBufferReset?: () => void,
): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Parent can briefly report 0×0 during flex layout; keep the previous CSS
  // size rather than collapsing the canvas to an invisible 0×0 box.
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  if (w <= 0 || h <= 0) return;
  const nextW = Math.max(1, Math.floor(w * dpr));
  const nextH = Math.max(1, Math.floor(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (canvas.width === nextW && canvas.height === nextH) return;
  canvas.width = nextW;
  canvas.height = nextH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  onBufferReset?.();
}

function sameSnap(
  a: readonly unknown[] | null,
  b: readonly unknown[],
): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function startPlayfieldRaf(opts: {
  getTimeMs: () => number;
  snapshot: () => readonly unknown[];
  paint: (tMs: number) => void;
  /**
   * Optional timer-driven tick (Hz). Off by default — preview/rewatch modals
   * only need change-gated rAF. tosu-counter passes 30 so the canvas stays
   * alive when the dashboard iframe reports `document.hidden` (rAF throttled).
   */
  heartbeatHz?: number;
}): { stop: () => void; invalidate: () => void } {
  let raf = 0;
  let timer = 0;
  let running = true;
  let lastT = Number.NaN;
  let lastSnap: readonly unknown[] | null = null;
  const heartbeatHz =
    typeof opts.heartbeatHz === "number" && opts.heartbeatHz > 0
      ? opts.heartbeatHz
      : 0;

  // Render once if the snapshot or clock changed since the last paint. When
  // called from `invalidate()` (below) this is also the synchronous repaint
  // that makes in-page edits show up immediately — independent of rAF, which
  // is throttled or paused inside embedded iframes (e.g. the tosu dashboard
  // preview reports `document.hidden` while still being visible on screen).
  function renderOnce() {
    const tMs = opts.getTimeMs();
    const snap = opts.snapshot();
    if (tMs !== lastT || !sameSnap(lastSnap, snap)) {
      lastT = tMs;
      lastSnap = snap;
      opts.paint(tMs);
    }
  }

  // Unconditional paint — used by the heartbeat while the document is hidden
  // so the canvas refreshes even when nothing "changed" (idle preview with no
  // live data). Without this, the first paint can land while the embedded
  // iframe isn't visible yet, and the change-gated `renderOnce` would then
  // never repaint once tosu shows it.
  function paintNow() {
    const tMs = opts.getTimeMs();
    lastT = tMs;
    lastSnap = opts.snapshot();
    opts.paint(tMs);
  }

  function frame() {
    if (!running) return;
    renderOnce();
    if (typeof requestAnimationFrame === "function") {
      raf = requestAnimationFrame(frame);
    }
  }

  // Heartbeat: timer-driven tick for embedded iframes where rAF is
  // dead/throttled. When the document is visible and rAF is running, stay
  // change-gated so we do not double-paint with the animation loop. When
  // hidden, force a paint so a now-visible preview always refreshes.
  function heartbeat() {
    if (!running) return;
    if (typeof document !== "undefined" && document.hidden) {
      paintNow();
      return;
    }
    renderOnce();
  }

  function startRaf() {
    if (
      raf ||
      typeof requestAnimationFrame !== "function" ||
      (typeof document !== "undefined" && document.hidden)
    ) {
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function invalidate() {
    lastT = Number.NaN;
    lastSnap = null;
    renderOnce();
  }

  function onVisibility() {
    if (!running) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    startRaf();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  startRaf();
  if (heartbeatHz > 0) {
    timer = setInterval(heartbeat, 1000 / heartbeatHz) as unknown as number;
  }

  return {
    stop: () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
    invalidate,
  };
}
