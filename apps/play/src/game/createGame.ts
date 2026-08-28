import { createLazerAssetResolver } from "../assets/LazerAssetResolver";
import type { AssetResolver } from "../assets/AssetResolver";
import { RoxysuDatabase } from "../database/RoxysuDatabase";
import { Game } from "./Game";

export function createGame(dbPath?: string): Game {
  const database = new RoxysuDatabase(dbPath);
  const assets: AssetResolver = createLazerAssetResolver(null);

  return new Game({
    database,
    assets,
    createAssets(osuDataPathOverride) {
      return createLazerAssetResolver(osuDataPathOverride);
    },
  });
}
