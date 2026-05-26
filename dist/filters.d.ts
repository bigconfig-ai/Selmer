import type { FilterFunction } from "./types.js";
export declare const filters: Map<string, FilterFunction>;
export declare function parseNumber(value: unknown): number;
export declare function getFilter(name: string): FilterFunction | undefined;
export declare function callFilter(name: string, ...args: unknown[]): unknown;
export declare function addFilter(name: string, fn: FilterFunction): void;
export declare const addFilter$: typeof addFilter;
export declare function removeFilter(name: string): void;
export declare const removeFilter$: typeof removeFilter;
