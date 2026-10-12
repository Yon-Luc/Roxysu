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

async function writeClipboardPng(blob: Blob): Promise<boolean> {
  try {
    if (
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard?.write
    ) {
      // Some Chromium builds require a Promise-valued ClipboardItem entry.
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": Promise.resolve(blob),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through to desktop bridge / download
  }

  if (isDesktopShell() && window.roxysuDesktop?.writeClipboardImage) {
    try {
      const buffer = new Uint8Array(await blob.arrayBuffer());
      await window.roxysuDesktop.writeClipboardImage(buffer);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Render a React share card off-screen, rasterize to PNG, copy to clipboard,
 * or download when clipboard write fails.
 */
export async function shareSessionImage(
  card: ReactElement,
  filename: string,
): Promise<ShareSessionImageResult> {
  const host = document.createElement("div");
  host.setAttribute("data-session-share-host", "1");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(card);
    // Let React commit + CSS apply before measuring images.
    await sleep(50);
    const cardEl =
      (host.querySelector("[data-session-share-card]") as HTMLElement | null) ??
      (host.firstElementChild as HTMLElement | null);
    if (!cardEl) {
      throw new Error("Share card failed to render");
    }

    await waitForImages(cardEl);
    await waitUntilLoad(cardEl, { timeout: 8_000 }).catch(() => undefined);
    // Brief settle for BeatmapCover opacity / fallback swaps.
    await sleep(100);

    const blob = await domToBlob(cardEl, {
      scale: 2,
      backgroundColor: "#12141a",
      type: "image/png",
    });
    if (!blob) {
      throw new Error("Failed to capture share image");
    }

    const copied = await writeClipboardPng(blob);
    if (copied) return "copied";

    downloadBlob(blob, filename);
    return "downloaded";
  } finally {
    root.unmount();
    host.remove();
  }
}
