import type { RenderOptions } from "./types.js";
import { Scanner } from "./scanner.js";
interface BlockInfo {
    super: boolean;
    content: string;
}
type Blocks = Record<string, BlockInfo | undefined>;
type Defaults = Record<string, string> | undefined;
declare class Buffer {
    value: string;
    append(s: string | undefined): void;
    toString(): string;
}
export declare function getTagParams(tagId: string, blockStr: string, opts?: RenderOptions): string;
export declare function parseDefaults(defaultParts?: string[]): Defaults;
export declare function splitIncludeTag(tagStr: string, opts?: RenderOptions): string[];
export declare function getParent(tagStr: string, opts?: RenderOptions): string;
export declare function consumeBlock(scanner: Scanner, opts: RenderOptions, buf?: Buffer, blocks?: Blocks, omitCloseTag?: boolean): boolean;
export declare function rewriteSuper(block: string, parentContent: string, opts?: RenderOptions): string;
export declare function readBlock(scanner: Scanner, blockTag: string, blocks: Blocks, opts: RenderOptions): Blocks;
export declare function processBlock(scanner: Scanner, buf: Buffer, blockTag: string, blocks: Blocks, opts: RenderOptions): void;
export declare function wrapInExpressionTag(s: string, opts?: RenderOptions): string;
export declare function wrapInVariableTag(s: string, opts?: RenderOptions): string;
export declare function trimVariableTag(s: string, opts?: RenderOptions): string;
export declare function trimExpressionTag(s: string, opts?: RenderOptions): string;
export declare function toExpressionString(tagName: string, args: string[], defaults: Defaults, opts?: RenderOptions): string;
export declare function addDefault(identifier: string, defaultValue: string): string;
export declare function tryAddDefault(identifier: string, defaults: Defaults): string;
export declare function addDefaultsToVariableTag(tagStr: string, defaults: Defaults, opts?: RenderOptions): string;
export declare function addDefaultsToExpressionTag(tagStr: string, defaults: Defaults, opts?: RenderOptions): string;
export declare function preprocessTemplateString(template: string, opts?: RenderOptions, blocks?: Blocks, defaults?: Defaults): string;
export declare function preprocessTemplateFile(template: string | URL, opts?: RenderOptions, blocks?: Blocks, defaults?: Defaults): string;
export declare function preprocessTemplate(template: string | URL, opts?: RenderOptions): string;
export {};
