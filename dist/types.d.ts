export type Context = Record<string, unknown> | Map<unknown, unknown>;
export type AccessorKey = string | number;
export type AccessorPath = AccessorKey[];
export interface RenderOptions {
    tagOpen?: string;
    tagClose?: string;
    filterOpen?: string;
    filterClose?: string;
    tagSecond?: string;
    shortCommentSecond?: string;
    cache?: boolean;
    customResourcePath?: string | URL | null;
    resourceLoader?: (path: string) => string | undefined | null;
    customTags?: Record<string, ExprTagHandler>;
    customFilters?: Record<string, FilterFunction>;
}
export interface Delimiters {
    tagOpen: string;
    tagClose: string;
    filterOpen: string;
    filterClose: string;
    tagSecond: string;
    shortCommentSecond: string;
}
export type TagType = "filter" | "expr";
export interface FilterTagInfo {
    tagType: "filter";
    tagValue: string;
}
export interface ExprTagInfo {
    tagType: "expr";
    tagName: string;
    args: string[];
}
export type TagInfo = FilterTagInfo | ExprTagInfo;
export interface TagContentBlock {
    args?: string[];
    content: TemplateNode[];
}
export type TagContentMap = Record<string, TagContentBlock | TagContentBlock[] | undefined>;
export type RenderFunction = (template: TemplateNode[], context: Context) => string;
export type TagContentFunction = (scanner: ScannerLike, startTag: string, ...endTags: string[]) => TagContentMap;
export type ExprTagHandler = (args: string[], tagContent: TagContentFunction, render: RenderFunction, scanner: ScannerLike) => (context: Context) => unknown;
export type CustomTagUserHandler = (args: string[], context: Context, content?: Record<string, any>) => unknown;
export type FilterFunction = (value: unknown, ...args: unknown[]) => unknown;
export interface TemplateNode {
    renderNode(context: Context): unknown;
}
export interface FunctionHandler {
    (context: Context): unknown;
    meta?: {
        tag?: TagInfo;
    };
}
export interface ScannerLike {
    readonly input: string;
    index: number;
    readonly delimiters: Delimiters;
    eof(): boolean;
    readChar(): string | undefined;
    peek(offset?: number): string | undefined;
    startsWith(value: string): boolean;
    readTagInfo(): TagInfo;
    readTagContent(): string;
    skipShortComment(): void;
}
export interface ParsedTemplate extends Array<TemplateNode> {
    allTags?: TagInfo[];
}
