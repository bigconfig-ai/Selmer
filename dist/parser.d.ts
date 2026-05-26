import type { Context, FunctionHandler, ParsedTemplate, RenderOptions, ScannerLike, TagContentMap, TagInfo, TemplateNode } from "./types.js";
import { addFilter } from "./filters.js";
import { parseAccessor, readResource } from "./util.js";
interface CachedTemplate {
    template: ParsedTemplate;
    lastModified: number;
}
declare const templates: Map<string, CachedTemplate>;
export { templates };
export declare function clearCache(): void;
export declare const clearCache$: typeof clearCache;
export declare function cacheOn(): void;
export declare const cacheOn$: typeof cacheOn;
export declare function cacheOff(): void;
export declare const cacheOff$: typeof cacheOff;
export declare function setResourcePath(path: string | URL | null): void;
export declare const setResourcePath$: typeof setResourcePath;
export declare function addFilter$ForParser(name: string, fn: Parameters<typeof addFilter>[1]): void;
export { addFilter as addFilter };
export declare function renderTemplate(template: TemplateNode[], context: Context): string;
export declare const renderTemplate$: typeof renderTemplate;
export declare function render(s: string, context?: Context, opts?: RenderOptions): string;
export declare function renderFile(filenameOrUrl: string | URL, context?: Context, opts?: RenderOptions): string;
export declare function parseString(input: string, opts?: RenderOptions): ParsedTemplate;
export declare function parseFile(file: string | URL, opts?: RenderOptions): ParsedTemplate;
export declare function parseInput(input: string, opts?: RenderOptions): ParsedTemplate;
export declare function parse(parseFn: (input: string, opts?: RenderOptions) => ParsedTemplate, input: string, opts?: RenderOptions): ParsedTemplate;
export declare function exprTag(tag: Extract<TagInfo, {
    tagType: "expr";
}>, scanner: ScannerLike, opts: RenderOptions, tags: TagInfo[]): FunctionHandler;
export declare function filterTag(tag: Extract<TagInfo, {
    tagType: "filter";
}>): FunctionHandler;
export declare function parseTag(tag: TagInfo, scanner: ScannerLike, opts: RenderOptions, tags: TagInfo[]): FunctionHandler;
export declare function tagContent(scanner: ScannerLike, startTag: string, opts: RenderOptions, allTags: TagInfo[], ...endTags0: string[]): TagContentMap;
export declare function knownVariablePaths(input: string, opts?: RenderOptions): ReturnType<typeof parseAccessor>[];
export declare function knownVariables(input: string, opts?: RenderOptions): Set<string | number>;
export declare function resolveArg(arg: string, context: Context): unknown;
export { readResource };
