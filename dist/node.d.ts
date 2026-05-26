import type { Context, FunctionHandler, TemplateNode } from "./types.js";
export declare class FunctionNode implements TemplateNode {
    readonly handler: FunctionHandler;
    constructor(handler: FunctionHandler);
    renderNode(context: Context): unknown;
    get meta(): FunctionHandler["meta"];
}
export declare class TextNode implements TemplateNode {
    readonly text: string;
    constructor(text: string);
    renderNode(_context: Context): string;
    toString(): string;
}
