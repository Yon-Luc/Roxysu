import { describe, expect, test } from "bun:test";
import { estimateDanielDan } from "./estimateDanielDan";

describe("estimateDanielDan", () => {
  test("maps mid-Alpha star to Alpha Mid", () => {
    const result = estimateDanielDan(6.5);
    expect(result.label).toBe("Alpha Mid");
    expect(result.numeric).not.toBeNull();
  });

  test("maps below-range stars", () => {
    const result = estimateDanielDan(5.5);
    expect(result.label).toBe("< Alpha Low");
    expect(result.numeric).toBeNull();
  });
});
