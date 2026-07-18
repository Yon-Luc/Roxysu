/** Normalize Drizzle timestamp / Date / number to ISO string or null. */
export function toIso(value: Date | number | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
