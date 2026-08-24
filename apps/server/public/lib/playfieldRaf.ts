export function resizePlayfieldCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  onBufferReset?: () => void,
): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = parent.clientWidth;
  const h = parent.clientHeight;
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
}): { stop: () => void; invalidate: () => void } {
  let raf = 0;
  let running = true;
  let lastT = Number.NaN;
  let lastSnap: readonly unknown[] | null = null;

  function invalidate() {
    lastT = Number.NaN;
    lastSnap = null;
  }

  function loop() {
    if (!running) return;
    if (typeof document !== "undefined" && document.hidden) {
      raf = 0;
      return;
    }
    const tMs = opts.getTimeMs();
    const snap = opts.snapshot();
    if (tMs !== lastT || !sameSnap(lastSnap, snap)) {
      lastT = tMs;
      lastSnap = snap;
      opts.paint(tMs);
    }
    raf = requestAnimationFrame(loop);
  }

  function onVisibility() {
    if (!running) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      invalidate();
      return;
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  raf = requestAnimationFrame(loop);

  return {
    stop: () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
    invalidate,
  };
}
