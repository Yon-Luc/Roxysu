import {
  buildResolvedOsuPaths,
  probeOsuPathStatus,
  type OsuPathStatus,
} from "../integrations/roxysu-paths";
import type { AssetAvailability, AssetResolver } from "./AssetResolver";
import { LazerFileStore } from "./LazerFileStore";

export class LazerAssetResolver implements AssetResolver {
  private readonly store: LazerFileStore;
  private readonly osuDataPath: string;
  private readonly pathStatus: OsuPathStatus;

  constructor(osuDataPathOverride: string | null | undefined) {
    const resolved = buildResolvedOsuPaths(osuDataPathOverride);
    this.osuDataPath = resolved.resolvedOsuDataPath;
    this.pathStatus = resolved.status;
    this.store = new LazerFileStore(this.osuDataPath);
  }

  getOsuDataPath(): string {
    return this.osuDataPath;
  }

  getOsuPathStatus(): OsuPathStatus {
    return this.pathStatus;
  }

  resolveBeatmap(hash: string): AssetAvailability {
    return this.resolve(hash);
  }

  resolveAudio(hash: string): AssetAvailability {
    return this.resolve(hash);
  }

  resolveBackground(hash: string): AssetAvailability {
    return this.resolve(hash);
  }

  private resolve(hash: string): AssetAvailability {
    if (!this.pathStatus.exists || !this.pathStatus.hasFiles) {
      return { status: "missing", reason: "osu_path_unavailable" };
    }

    if (!this.store.isValidHash(hash)) {
      return { status: "missing", reason: "invalid_hash" };
    }

    const path = this.store.resolve(hash);
    if (!path || !this.store.exists(hash)) {
      return { status: "missing", reason: "file_missing" };
    }

    return { status: "available", path };
  }
}

export function createLazerAssetResolver(
  osuDataPathOverride: string | null | undefined,
): LazerAssetResolver {
  return new LazerAssetResolver(osuDataPathOverride);
}

export function probeLazerPath(osuDataPath: string): OsuPathStatus {
  return probeOsuPathStatus(osuDataPath);
}
