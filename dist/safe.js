export const SAFE_FILTER = Symbol.for("selmer.safe-filter");
export const SAFE_CONTEXT_KEY = "__selmerSafeFilter";
export function safe(value) {
    return { [SAFE_FILTER]: true, value };
}
export function isSafeValue(value) {
    return Boolean(value && typeof value === "object" && value[SAFE_FILTER]);
}
export function unwrapSafe(value) {
    if (isSafeValue(value))
        return value.value;
    if (Array.isArray(value) && (value[0] === ":safe" || value[0] === "safe"))
        return value[1];
    return value;
}
//# sourceMappingURL=safe.js.map