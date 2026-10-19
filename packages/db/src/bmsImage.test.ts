import { describe, expect, test } from "bun:test";
import { parseBmsImageFilename } from "./bmsInterpret";

describe("parseBmsImageFilename", () => {
  test("prefers the stage file over a movie bitmap", () => {
    const text = ["#TITLE chart", "#BMP00 movie.mpg", "#STAGEFILE stagefile.jpg", "#00111:00"].join(
      "\n",
    );
    expect(parseBmsImageFilename(text)).toBe("stagefile.jpg");
  });

  test("uses the first still bitmap when there is no stage file", () => {
    const text = ["#BMP00 movie.mpg", "#BMP01 back.png", "#00111:00"].join("\n");
    expect(parseBmsImageFilename(text)).toBe("back.png");
  });

  test("falls through stage, banner, then back bitmap", () => {
    expect(parseBmsImageFilename("#BANNER banner.jpg\n#BACKBMP back.bmp\n#BMP00 still.png")).toBe(
      "banner.jpg",
    );
    expect(parseBmsImageFilename("#BACKBMP back.bmp\n#BMP00 still.png")).toBe("back.bmp");
  });

  test("ignores video-only charts", () => {
    expect(parseBmsImageFilename("#BMP00 movie.mpg\n#00111:00")).toBeNull();
  });
});
