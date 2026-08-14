import {
  clampPreviewEmbedHeightRem,
  PREVIEW_EMBED_HEIGHT_DEFAULT,
  PREVIEW_EMBED_HEIGHT_MAX,
  PREVIEW_EMBED_HEIGHT_MIN,
} from "../../components/BeatmapPreviewEmbed";

export const NOW_SELECTED_WIDGETS = [
  "identity",
  "preview",
  "patternWeights",
  "densityOverTime",
  "livePlay",
  "rating",
  "hotspots",
  "personalStats",
] as const;

export type NowSelectedWidgetId = (typeof NOW_SELECTED_WIDGETS)[number];

export type NowSelectedLayout = {
  order: NowSelectedWidgetId[];
  visible: Record<NowSelectedWidgetId, boolean>;
  autoPlayPreview: boolean;
  mutePreview: boolean;
  pauseWhilePlaying: boolean;
  /** Playfield stage height in rem (clamped). */
  previewHeightRem: number;
};

const STORAGE_KEY = "roxysu:now-selected-layout";

const DEFAULT_VISIBLE: Record<NowSelectedWidgetId, boolean> = {
  identity: true,
  preview: true,
  patternWeights: true,
  densityOverTime: true,
  livePlay: true,
  rating: true,
  hotspots: false,
  personalStats: false,
};

export const DEFAULT_NOW_SELECTED_LAYOUT: NowSelectedLayout = {
  order: [...NOW_SELECTED_WIDGETS],
  visible: { ...DEFAULT_VISIBLE },
  autoPlayPreview: true,
  mutePreview: false,
  pauseWhilePlaying: true,
  previewHeightRem: PREVIEW_EMBED_HEIGHT_DEFAULT,
};

function isWidgetId(value: unknown): value is NowSelectedWidgetId {
  return (
    typeof value === "string" &&
    (NOW_SELECTED_WIDGETS as readonly string[]).includes(value)
  );
}

export function loadNowSelectedLayout(): NowSelectedLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOW_SELECTED_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<NowSelectedLayout>;
    const orderRaw = Array.isArray(parsed.order) ? parsed.order : [];
    const seen = new Set<NowSelectedWidgetId>();
    const order: NowSelectedWidgetId[] = [];
    for (const id of orderRaw) {
      if (!isWidgetId(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const id of NOW_SELECTED_WIDGETS) {
      if (!seen.has(id)) order.push(id);
    }
    const visible = { ...DEFAULT_VISIBLE };
    if (parsed.visible && typeof parsed.visible === "object") {
      for (const id of NOW_SELECTED_WIDGETS) {
        const flag = (parsed.visible as Record<string, unknown>)[id];
        if (typeof flag === "boolean") visible[id] = flag;
      }
    }
    return {
      order,
      visible,
      autoPlayPreview:
        typeof parsed.autoPlayPreview === "boolean"
          ? parsed.autoPlayPreview
          : DEFAULT_NOW_SELECTED_LAYOUT.autoPlayPreview,
      mutePreview:
        typeof parsed.mutePreview === "boolean"
          ? parsed.mutePreview
          : DEFAULT_NOW_SELECTED_LAYOUT.mutePreview,
      pauseWhilePlaying:
        typeof parsed.pauseWhilePlaying === "boolean"
          ? parsed.pauseWhilePlaying
          : DEFAULT_NOW_SELECTED_LAYOUT.pauseWhilePlaying,
      previewHeightRem: clampPreviewEmbedHeightRem(
        typeof parsed.previewHeightRem === "number"
          ? parsed.previewHeightRem
          : DEFAULT_NOW_SELECTED_LAYOUT.previewHeightRem,
      ),
    };
  } catch {
    return DEFAULT_NOW_SELECTED_LAYOUT;
  }
}

export function saveNowSelectedLayout(layout: NowSelectedLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore quota / private mode
  }
}

export function moveWidget(
  order: NowSelectedWidgetId[],
  id: NowSelectedWidgetId,
  dir: -1 | 1,
): NowSelectedWidgetId[] {
  const idx = order.indexOf(id);
  if (idx < 0) return order;
  const next = idx + dir;
  if (next < 0 || next >= order.length) return order;
  const copy = [...order];
  const [item] = copy.splice(idx, 1);
  copy.splice(next, 0, item!);
  return copy;
}

export {
  clampPreviewEmbedHeightRem as clampPreviewHeightRem,
  PREVIEW_EMBED_HEIGHT_MAX as PREVIEW_HEIGHT_MAX,
  PREVIEW_EMBED_HEIGHT_MIN as PREVIEW_HEIGHT_MIN,
};
