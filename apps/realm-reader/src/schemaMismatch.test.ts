import { describe, expect, test } from "bun:test";
import {
  SchemaVersionMismatchError,
  toSchemaVersionMismatchError,
} from "./schemaMismatch";

describe("toSchemaVersionMismatchError", () => {
  test("parses Realm's open error into expected and actual versions", () => {
    const err = toSchemaVersionMismatchError(
      new Error(
        "Provided schema version 51 does not equal last set version 52.",
      ),
    );
    expect(err).toBeInstanceOf(SchemaVersionMismatchError);
    expect(err?.expected).toBe(51);
    expect(err?.actual).toBe(52);
  });

  test("returns the same error when already typed", () => {
    const original = new SchemaVersionMismatchError(51, 52);
    expect(toSchemaVersionMismatchError(original)).toBe(original);
  });

  test("ignores unrelated failures", () => {
    expect(toSchemaVersionMismatchError(new Error("realm locked"))).toBeNull();
    expect(toSchemaVersionMismatchError("nope")).toBeNull();
  });
});
