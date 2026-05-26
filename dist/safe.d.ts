export declare const SAFE_FILTER: unique symbol;
export declare const SAFE_CONTEXT_KEY = "__selmerSafeFilter";
export interface SafeValue {
    readonly [SAFE_FILTER]: true;
    readonly value: unknown;
}
export declare function safe(value: unknown): SafeValue;
export declare function isSafeValue(value: unknown): value is SafeValue;
export declare function unwrapSafe(value: unknown): unknown;
