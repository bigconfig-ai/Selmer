import type { Context, FunctionHandler, TemplateNode } from "./types.js";

export class FunctionNode implements TemplateNode {
  public readonly handler: FunctionHandler;

  constructor(handler: FunctionHandler) {
    this.handler = handler;
  }

  renderNode(context: Context): unknown {
    return this.handler(context);
  }

  get meta(): FunctionHandler["meta"] {
    return this.handler.meta;
  }
}

export class TextNode implements TemplateNode {
  public readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  renderNode(_context: Context): string {
    return String(this.text);
  }

  toString(): string {
    return String(this.text);
  }
}
