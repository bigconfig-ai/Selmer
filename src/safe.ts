export const SAFE_FILTER = Symbol.for("selmer.safe-filter");
export const SAFE_CONTEXT_KEY = "__selmerSafeFilter";

export interface SafeValue {
  readonly [SAFE_FILTER]: true;
  readonly value: unknown;
}

export function safe(value: unknown): SafeValue {
  return { [SAFE_FILTER]: true, value };
}

export function isSafeValue(value: unknown): value is SafeValue {
  return Boolean(value && typeof value === "object" && (value as SafeValue)[SAFE_FILTER]);
}

export function unwrapSafe(value: unknown): unknown {
  if (isSafeValue(value)) return value.value;
  if (Array.isArray(value) && (value[0] === ":safe" || value[0] === "safe")) return value[1];
  return value;
}
