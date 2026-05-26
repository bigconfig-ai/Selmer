import type { RenderOptions, TagInfo } from "./types.js";
export declare function validateOn(): void;
export declare const validateOn$: typeof validateOn;
export declare function validateOff(): void;
export declare const validateOff$: typeof validateOff;
export declare class SelmerValidationError extends Error {
    readonly data: Record<string, unknown>;
    constructor(message: string, data: Record<string, unknown>);
}
export declare const errorTemplate: string;
export declare function formatTag(tag?: TagInfo): string;
export declare function validationError(error: string, tag?: TagInfo, line?: number, template?: string | URL): never;
export declare function validateTags(content: string, template: string | URL, opts?: RenderOptions): Array<TagInfo & {
    line: number;
}>;
export declare function validate(template: string | URL, opts?: RenderOptions): void;
