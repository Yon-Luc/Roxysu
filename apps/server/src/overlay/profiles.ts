import type { Db } from "@roxysu/db/types";
import { settings } from "@roxysu/db/schema";
import { eq } from "drizzle-orm";

import { OVERLAY_PROFILES_KEY } from "@roxysu/db/settings-keys";

export type OverlayElementType =
  | "scoreList"
  | "identity"
  | "difficulty"
  | "livePlay"
  | "preview"
  | "analysis"
  | "sessionStats"
  | "personalStats"
  | "density";

export const OVERLAY_ELEMENT_TYPES: OverlayElementType[] = [
  "scoreList",
  "identity",
  "difficulty",
  "livePlay",
  "preview",
  "analysis",
  "sessionStats",
  "personalStats",
  "density",
];

export type OverlayTriggerField = "play.active" | "status" | "connected";

export const OVERLAY_TRIGGER_FIELDS: OverlayTriggerField[] = [
  "play.active",
  "status",
  "connected",
];

export type OverlayTrigger = {
  field: OverlayTriggerField;
  op: "is" | "isNot";
  value: boolean | string;
  action: "hide" | "show" | "fade";
};

export type OverlayElementInstance = {
  instanceId: string;
  type: OverlayElementType;
  x: number;
  y: number;
  scale: number;
  /** Element-specific options (score list limit, preview height, …). */
  options?: Record<string, unknown>;
  trigger?: OverlayTrigger | null;
};

export type OverlayProfile = {
  id: string;
  name: string;
  width: number;
  height: number;
  bg: "solid" | "clear";
  elements: OverlayElementInstance[];
};

export const OVERLAY_PROFILE_MIN_SIZE = 320;
export const OVERLAY_PROFILE_MAX_SIZE = 7680;

/** Legacy layout used when no profile is requested / none exists yet. */
export function defaultOverlayProfile(): OverlayProfile {
  return {
    id: "default",
    name: "Default",
    width: 1920,
    height: 1080,
    bg: "clear",
    elements: [
      {
        instanceId: "default-scores",
        type: "scoreList",
        x: 12,
        y: 12,
        scale: 1,
        options: { limit: 8 },
        trigger: null,
      },
    ],
  };
}

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeId(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim().slice(0, 64);
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeTrigger(raw: unknown): OverlayTrigger | null {
  if (raw == null || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (!OVERLAY_TRIGGER_FIELDS.includes(t.field as OverlayTriggerField)) {
    return null;
  }
  let value: boolean | string;
  if (t.field === "play.active" || t.field === "connected") {
    value = Boolean(t.value);
  } else {
    const allowed = ["disabled", "connecting", "connected", "disconnected"];
    value =
      typeof t.value === "string" && allowed.includes(t.value)
        ? t.value
        : "connected";
  }
  return {
    field: t.field as OverlayTriggerField,
    op: t.op === "isNot" ? "isNot" : "is",
    value,
    action: t.action === "fade" || t.action === "show" ? t.action : "hide",
  };
}

function sanitizeElement(raw: unknown): OverlayElementInstance | null {
  if (raw == null || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const type = e.type as OverlayElementType;
  if (!OVERLAY_ELEMENT_TYPES.includes(type)) return null;
  const scale = clampNumber(e.scale, 0.25, 4, 1);
  return {
    instanceId: sanitizeId(e.instanceId, `el-${Math.random().toString(36).slice(2, 10)}`),
    type,
    x: Math.round(clampNumber(e.x, -OVERLAY_PROFILE_MAX_SIZE, OVERLAY_PROFILE_MAX_SIZE, 0)),
    y: Math.round(clampNumber(e.y, -OVERLAY_PROFILE_MAX_SIZE, OVERLAY_PROFILE_MAX_SIZE, 0)),
    scale,
    options:
      e.options != null && typeof e.options === "object"
        ? (e.options as Record<string, unknown>)
        : undefined,
    trigger: sanitizeTrigger(e.trigger),
  };
}

export function sanitizeOverlayProfile(raw: unknown): OverlayProfile | null {
  if (raw == null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const width = Math.round(
    clampNumber(p.width, OVERLAY_PROFILE_MIN_SIZE, OVERLAY_PROFILE_MAX_SIZE, 1920),
  );
  const height = Math.round(
    clampNumber(p.height, OVERLAY_PROFILE_MIN_SIZE, OVERLAY_PROFILE_MAX_SIZE, 1080),
  );
  const elementsRaw = Array.isArray(p.elements) ? p.elements.slice(0, 32) : [];
  const elements = elementsRaw
    .map(sanitizeElement)
    .filter((e): e is OverlayElementInstance => e != null);
  return {
    id: sanitizeId(p.id, `profile-${Math.random().toString(36).slice(2, 10)}`),
    name: sanitizeId(p.name, "Unnamed"),
    width,
    height,
    bg: p.bg === "solid" ? "solid" : "clear",
    elements,
  };
}

export function sanitizeOverlayProfiles(raw: unknown): OverlayProfile[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const profiles: OverlayProfile[] = [];
  for (const item of raw) {
    const profile = sanitizeOverlayProfile(item);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    profiles.push(profile);
  }
  return profiles;
}

export async function readOverlayProfiles(db: Db): Promise<OverlayProfile[]> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_PROFILES_KEY))
    .limit(1);
  if (!row?.value) return [];
  try {
    return sanitizeOverlayProfiles(JSON.parse(row.value));
  } catch {
    return [];
  }
}

export async function writeOverlayProfiles(
  db: Db,
  profiles: OverlayProfile[],
): Promise<void> {
  const value = JSON.stringify(profiles);
  await db
    .insert(settings)
    .values({ key: OVERLAY_PROFILES_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Resolve a profile by id or display name; falls back to the legacy default. */
export function resolveOverlayProfile(
  profiles: OverlayProfile[],
  ref: string | undefined,
): OverlayProfile {
  if (!ref) return defaultOverlayProfile();
  const needle = ref.trim().toLowerCase();
  return (
    profiles.find((p) => p.id.toLowerCase() === needle) ??
    profiles.find((p) => p.name.toLowerCase() === needle) ??
    defaultOverlayProfile()
  );
}
