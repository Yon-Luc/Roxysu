import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { domToBlob, waitUntilLoad } from "modern-screenshot";
import { downloadBlob } from "./replayVideoExport";
import { isDesktopShell } from "./desktop";

export type ShareSessionImageResult = "copied" | "downloaded";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForImages(root: HTMLElement, timeoutMs = 8_000): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  if (images.length === 0) return;

  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          }),
      ),
    ),
    sleep(timeoutMs),
  ]);
}

async function writeViaDesktop(blob: Blob): Promise<boolean> {
  if (!isDesktopShell() || !window.roxysuDesktop?.writeClipboardImage) {
    return false;
  }
  const buffer = new Uint8Array(await blob.arrayBuffer());
  await window.roxysuDesktop.writeClipboardImage(buffer);
  return true;
}

/**
 * Start a clipboard image write while user activation is still valid.
 * Chromium accepts a Promise-valued ClipboardItem entry, so capture can finish
 * after this call returns — as long as `write()` itself runs in the click turn.
 */
function beginDeferredClipboardPngWrite(): {
  deliver: (blob: Blob) => void;
  fail: (error: unknown) => void;
  /** Resolves true if the deferred clipboard write succeeded. */
  settled: Promise<boolean>;
} {
  let resolveBlob!: (blob: Blob) => void;
  let rejectBlob!: (error: unknown) => void;
  const blobPromise = new Promise<Blob>((resolve, reject) => {
    resolveBlob = resolve;
    rejectBlob = reject;
  });

  let settled!: Promise<boolean>;
  if (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  ) {
    settled = navigator.clipboard
      .write([
        new ClipboardItem({
          "image/png": blobPromise,
        }),
      ])
      .then(() => true)
      .catch(() => false);
  } else {
    settled = Promise.resolve(false);
  }

  return {
    deliver: (blob) => resolveBlob(blob),
    fail: (error) => rejectBlob(error),
    settled,
  };
}

async function captureSessionPng(card: ReactElement): Promise<Blob> {
  const host = document.createElement("div");
  host.setAttribute("data-session-share-host", "1");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(card);
    await sleep(50);
    const cardEl =
      (host.querySelector("[data-session-share-card]") as HTMLElement | null) ??
      (host.firstElementChild as HTMLElement | null);
    if (!cardEl) {
      throw new Error("Share card failed to render");
    }

    await waitForImages(cardEl);
    await waitUntilLoad(cardEl, { timeout: 8_000 }).catch(() => undefined);
    await sleep(100);

    const blob = await domToBlob(cardEl, {
      scale: 2,
      backgroundColor: "#12141a",
      type: "image/png",
    });
    if (!blob) {
      throw new Error("Failed to capture share image");
    }
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * Capture a session share card and copy the PNG to the clipboard.
 * Must be invoked directly from a click handler (no prior awaits) so the
 * deferred ClipboardItem write keeps user activation.
 *
 * Falls back to Electron IPC, then download, if clipboard write is unsupported.
 */
export async function shareSessionImage(
  card: ReactElement,
  filename = "roxysu-session.png",
): Promise<ShareSessionImageResult> {
  // Must run before any await in the caller for Chromium clipboard activation.
  const deferred = beginDeferredClipboardPngWrite();

  try {
    const blob = await captureSessionPng(card);
    deferred.deliver(blob);

    if (await deferred.settled) {
      return "copied";
    }

    if (await writeViaDesktop(blob)) {
      return "copied";
    }

    // Browser without image clipboard (or gesture already spent upstream).
    downloadBlob(blob, filename);
    return "downloaded";
  } catch (error) {
    deferred.fail(error);
    throw error;
  }
}
