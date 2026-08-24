import type {
  OverlayElementInstance,
  OverlayElementType,
  OverlayProfile,
  OverlayTrigger,
  OverlayTriggerField,
} from "../../lib/api";
import type { TosuLive } from "../../lib/api";

export const OVERLAY_ELEMENT_DEFS: {
  type: OverlayElementType;
  label: string;
  hint: string;
}[] = [
  { type: "scoreList", label: "Score list", hint: "Live session / recent scores" },
  { type: "identity", label: "Map identity", hint: "Title · artist · version · mapper" },
  { type: "difficulty", label: "Difficulty", hint: "Star rating, keys, mods" },
  { type: "livePlay", label: "Live play", hint: "Accuracy, combo, score, PP" },
  { type: "preview", label: "Preview", hint: "Embedded playfield of the selected map" },
  { type: "analysis", label: "Analysis", hint: "Sunny star + dominant pattern" },
  { type: "sessionStats", label: "Session stats", hint: "Session name and play count" },
  { type: "personalStats", label: "Personal stats", hint: "Plays / best acc / best PP" },
  { type: "density", label: "Density", hint: "Density over time mini-graph" },
];

export const TRIGGER_FIELD_LABELS: Record<OverlayTriggerField, string> = {
  "play.active": "Song playing",
  status: "tosu status",
  connected: "tosu connected",
};

export function makeInstanceId(type: OverlayElementType): string {
  return `${type}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeElement(
  type: OverlayElementType,
  x: number,
  y: number,
): OverlayElementInstance {
  const el: OverlayElementInstance = {
    instanceId: makeInstanceId(type),
    type,
    x,
    y,
    scale: 1,
    trigger: null,
  };
  if (type === "scoreList") el.options = { limit: 8 };
  if (type === "preview") el.options = { previewHeightRem: 24 };
  if (type === "identity") {
    el.options = { showAnalysis: false, ratingSource: "dan", showPattern: false };
  }
  return el;
}

export type IdentityOptions = {
  showAnalysis: boolean;
  /** Which difficulty estimate to show when analysis is on. */
  ratingSource: "dan" | "star";
  showPattern: boolean;
};

export function identityOptions(
  options?: Record<string, unknown>,
): IdentityOptions {
  return {
    showAnalysis: options?.showAnalysis === true,
    ratingSource: options?.ratingSource === "star" ? ("star" as const) : ("dan" as const),
    showPattern: options?.showPattern === true,
  };
}

export function makeProfile(name: string): OverlayProfile {
  return {
    id: `profile-${Math.random().toString(36).slice(2, 10)}`,
    name,
    width: 1920,
    height: 1080,
    bg: "clear",
    elements: [],
  };
}

export const SIZE_PRESETS = [
  { label: "1080p", width: 1920, height: 1080 },
  { label: "1440p", width: 2560, height: 1440 },
  { label: "4K", width: 3840, height: 2160 },
] as const;

export function clampProfileSize(value: number): number {
  if (!Number.isFinite(value)) return 1920;
  return Math.min(7680, Math.max(320, Math.round(value)));
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0.25, value));
}

export function clampScoreListLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.min(Math.floor(n), 25);
}

export function clampPreviewHeightRem(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 24;
  return Math.min(52, Math.max(18, Math.round(n)));
}

/** Evaluate an element's overlay trigger against the tosu live snapshot. */
export function evaluateTrigger(
  trigger: OverlayTrigger | null | undefined,
  snapshot: TosuLive | null | undefined,
): boolean {
  if (!trigger || !snapshot) return true;
  let actual: boolean | string = false;
  switch (trigger.field) {
    case "play.active":
      actual = Boolean(snapshot.play?.active);
      break;
    case "status":
      actual = snapshot.status;
      break;
    case "connected":
      actual = Boolean(snapshot.connected);
      break;
  }
  const matched =
    trigger.op === "is"
      ? actual === trigger.value
      : actual !== trigger.value;
  return matched;
}

export interface ElementTriggerState {
  /** Render the element at all. */
  visible: boolean;
  /** Keep space but dim it (trigger action = "fade"). */
  faded: boolean;
}

export function elementTriggerState(
  element: OverlayElementInstance,
  snapshot: TosuLive | null | undefined,
): ElementTriggerState {
  const trigger = element.trigger ?? null;
  if (!trigger) return { visible: true, faded: false };
  const matched = evaluateTrigger(trigger, snapshot);
  if (matched) return { visible: true, faded: false };
  switch (trigger.action) {
    case "hide":
      return { visible: false, faded: false };
    case "fade":
      return { visible: true, faded: true };
    case "show":
    default:
      return { visible: false, faded: false };
  }
}
