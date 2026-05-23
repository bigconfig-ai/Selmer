import type { Delimiters, ScannerLike, TagInfo } from "./types.js";
import {
  expressionClose,
  expressionOpen,
  shortCommentClose,
  shortCommentOpen,
  variableClose,
  variableOpen
} from "./util.js";

export class Scanner implements ScannerLike {
  public index = 0;
  public readonly input: string;
  public readonly delimiters: Delimiters;
  private readonly tagCollector?: TagInfo[];

  constructor(input: string, delimiters: Delimiters, tagCollector?: TagInfo[]) {
    this.input = input;
    this.delimiters = delimiters;
    this.tagCollector = tagCollector;
  }

  eof(): boolean {
    return this.index >= this.input.length;
  }

  readChar(): string | undefined {
    if (this.eof()) return undefined;
    const ch = this.input[this.index];
    this.index += 1;
    return ch;
  }

  peek(offset = 0): string | undefined {
    return this.input[this.index + offset];
  }

  startsWith(value: string): boolean {
    return this.input.startsWith(value, this.index);
  }

  startsTag(): boolean {
    return this.startsWith(variableOpen(this.delimiters)) || this.startsWith(expressionOpen(this.delimiters));
  }

  startsShortComment(): boolean {
    return this.startsWith(shortCommentOpen(this.delimiters));
  }

  skipShortComment(): void {
    const close = shortCommentClose(this.delimiters);
    const end = this.input.indexOf(close, this.index + shortCommentOpen(this.delimiters).length);
    if (end < 0) throw new Error("short-form comment tag was not closed");
    this.index = end + close.length;
  }

  readTagContent(): string {
    const start = this.index;
    const variable = this.startsWith(variableOpen(this.delimiters));
    const expr = this.startsWith(expressionOpen(this.delimiters));
    if (!variable && !expr) throw new Error(`Expected opening delimiter at ${this.index}`);
    const close = variable ? variableClose(this.delimiters) : expressionClose(this.delimiters);
    const end = this.input.indexOf(close, this.index + 2);
    if (end < 0) {
      throw new Error(`Expected closing delimiter: ${this.input.slice(start)}`);
    }
    this.index = end + close.length;
    return this.input.slice(start, this.index);
  }

  readTagInfo(): TagInfo {
    const start = this.index;
    const variable = this.startsWith(variableOpen(this.delimiters));
    const expr = this.startsWith(expressionOpen(this.delimiters));
    if (!variable && !expr) throw new Error(`Expected opening delimiter at ${this.index}`);
    const open = variable ? variableOpen(this.delimiters) : expressionOpen(this.delimiters);
    const close = variable ? variableClose(this.delimiters) : expressionClose(this.delimiters);
    const contentStart = this.index + open.length;
    const end = this.input.indexOf(close, contentStart);
    if (end < 0) throw new Error(`Expected closing delimiter: ${this.input.slice(start)}`);
    const rawContent = this.input.slice(contentStart, end);
    this.index = end + close.length;
    checkTagArgs(rawContent);

    const tag: TagInfo = variable
      ? { tagType: "filter", tagValue: rawContent.trim() }
      : (() => {
          const parts = rawContent.match(/(?:[^\s"]|"[^"]*")+/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
          return { tagType: "expr", tagName: parts[0] ?? "", args: parts.slice(1) };
        })();
    this.tagCollector?.push(tag);
    return tag;
  }
}

export function checkTagArgs(args: string): string {
  const quotes = [...args].filter((ch) => ch === '"').length;
  if (quotes % 2 !== 0) throw new Error(`malformed tag arguments in ${args}`);
  return args;
}

export function readTagInfoFromString(tagString: string, delimiters: Delimiters): TagInfo {
  const scanner = new Scanner(tagString, delimiters);
  return scanner.readTagInfo();
}

export function tagInnerContent(tagString: string, delimiters: Delimiters): string {
  if (tagString.startsWith(variableOpen(delimiters))) {
    return tagString.slice(variableOpen(delimiters).length, -variableClose(delimiters).length).trim();
  }
  if (tagString.startsWith(expressionOpen(delimiters))) {
    return tagString.slice(expressionOpen(delimiters).length, -expressionClose(delimiters).length).trim();
  }
  return tagString;
}
