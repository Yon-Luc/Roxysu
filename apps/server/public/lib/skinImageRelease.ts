/** Drop a decoded skin image so the GPU can reuse its texture. */
export function releaseSkinImage(img: unknown): void {
  if (!img || typeof img !== "object") return;
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
    try {
      img.close();
    } catch {
      // already closed
    }
  }
  const url = (img as { __blobUrl?: string }).__blobUrl;
  if (typeof url === "string") URL.revokeObjectURL(url);
}

/** Release every image field on a sprite bag (arrays included). */
export function releaseSkinFields(
  fields: object | null | undefined,
): void {
  if (!fields) return;
  for (const item of Object.values(fields)) {
    if (Array.isArray(item)) {
      for (const nested of item) releaseSkinImage(nested);
    } else {
      releaseSkinImage(item);
    }
  }
}
