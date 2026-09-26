export class SchemaVersionMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `Realm schemaVersion mismatch: expected ${expected} (from osu-client.schema.json), got ${actual}. Re-run export-schema and update mappers.`,
    );
    this.name = "SchemaVersionMismatchError";
  }
}

/** Realm JS refuses to open when the file schema is not the version we pass. */
const REALM_SCHEMA_VERSION_RE =
  /Provided schema version (\d+) does not equal last set version (\d+)/i;

/**
 * Realm's own open error ("Provided schema version 51 does not equal last set
 * version 52.") or an already-typed mismatch. `expected` is this build's
 * schema; `actual` is the version stored in client.realm.
 */
export function toSchemaVersionMismatchError(
  err: unknown,
): SchemaVersionMismatchError | null {
  if (err instanceof SchemaVersionMismatchError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const match = REALM_SCHEMA_VERSION_RE.exec(msg);
  if (!match) return null;
  const expected = Number(match[1]);
  const actual = Number(match[2]);
  if (!Number.isInteger(expected) || !Number.isInteger(actual)) return null;
  return new SchemaVersionMismatchError(expected, actual);
}
