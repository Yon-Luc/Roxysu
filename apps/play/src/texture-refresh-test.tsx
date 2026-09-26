import { render } from "@gpuix/react";
import { gpuixRenderOptions } from "./components/ui";
import { TextureRefreshTest } from "./playfield/TextureRefreshTest";
import {
  primeTextureTestForMode,
  textureTestDir,
  type TextureTestMode,
} from "./playfield/textureRefreshTestPngs";

function parseMode(): TextureTestMode {
  const value = process.env.TEXTURE_TEST_MODE;
  if (value === "A" || value === "B" || value === "C") return value;
  return "B";
}

const mode = parseMode();
primeTextureTestForMode(mode);

console.log(`[texture-test] mode=${mode} dir=${textureTestDir()}`);

render(
  <TextureRefreshTest initialMode={mode} />,
  gpuixRenderOptions({
    title: `Roxysu — texture test ${mode}`,
    width: 560,
    height: 640,
  }),
);
