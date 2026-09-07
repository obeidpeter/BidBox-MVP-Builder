// Shared closed-contract validation primitives for the workbench's strict
// response adapters. Each export is the dominant byte-identical family of the
// helpers previously duplicated across the contract modules; semantically
// different local variants (trimmed/looser text checks, [1-5]-version UUID
// forms, optional-key contracts, set-based or sorted boolean key checks)
// deliberately remain local to their modules.

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(
  value: unknown,
  onInvalid: () => never,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    onInvalid();
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

export function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  onInvalid: () => never,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    onInvalid();
  }
}

export function boundedText(
  value: unknown,
  max: number,
  onInvalid: () => never,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  ) {
    onInvalid();
  }
  return value as string;
}
