import {
  isLazerFileHash,
  lazerFileExists,
  resolveLazerFilePath,
} from "../integrations/lazer-files";

export class LazerFileStore {
  constructor(private readonly osuDataPath: string) {}

  resolve(hash: string): string | null {
    return resolveLazerFilePath(hash, this.osuDataPath);
  }

  exists(hash: string): boolean {
    return lazerFileExists(hash, this.osuDataPath);
  }

  isValidHash(hash: string): boolean {
    return isLazerFileHash(hash);
  }
}
