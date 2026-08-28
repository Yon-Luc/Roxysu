import type { OsuPathStatus } from "../integrations/roxysu-paths";

export type AssetAvailability =
  | { status: "available"; path: string }
  | {
      status: "missing";
      reason: "invalid_hash" | "osu_path_unavailable" | "file_missing";
    };

export interface AssetResolver {
  resolveBeatmap(hash: string): AssetAvailability;
  resolveAudio(hash: string): AssetAvailability;
  resolveBackground(hash: string): AssetAvailability;
  getOsuDataPath(): string;
  getOsuPathStatus(): OsuPathStatus;
}
