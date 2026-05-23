import type { Delimiters, RenderOptions } from "./types.js";
import {
  escapeRegExp,
  expressionClose,
  expressionOpen,
  makeDelimiters,
  readResource,
  variableClose,
  variableOpen
} from "./util.js";
import { Scanner, readTagInfoFromString, tagInnerContent } from "./scanner.js";
import { validate } from "./validator.js";

interface BlockInfo {
  super: boolean;
  content: string;
}

type Blocks = Record<string, BlockInfo | undefined>;
type Defaults = Record<string, string> | undefined;

class Buffer {
  value = "";
  append(s: string | undefined): void {
    if (s != null) this.value += s;
  }
  toString(): string {
    return this.value;
  }
}

function tagInfo(tagStr: string, delimiters: Delimiters) {
  return readTagInfoFromString(tagStr, delimiters);
}

export function getTagParams(tagId: string, blockStr: string, opts: RenderOptions = {}): string {
  const d = makeDelimiters(opts);
  const info = tagInfo(blockStr, d);
  if (info.tagType !== "expr" || info.tagName !== tagId) return "";
  return info.args.join(" ").trim();
}

export function parseDefaults(defaultParts?: string[]): Defaults {
  if (!defaultParts || defaultParts.length === 0) return undefined;
  const joined = defaultParts.join(" ");
  const defaults: Record<string, string> = {};
  const re = /([^=\s]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(joined))) defaults[match[1]] = match[2];
  return defaults;
}

export function splitIncludeTag(tagStr: string, opts: RenderOptions = {}): string[] {
  const params = getTagParams("include", tagStr.replace(/\\/g, "/"), opts);
  return params.match(/"[^"]*"|[^\s]+/g) ?? [];
}

export function getParent(tagStr: string, opts: RenderOptions = {}): string {
  const template = getTagParams("extends", tagStr, opts);
  return template.startsWith('"') && template.endsWith('"') ? template.slice(1, -1) : template;
}

function classifyTag(tagStr: string, delimiters: Delimiters) {
  const info = tagInfo(tagStr, delimiters);
  return {
    info,
    include: info.tagType === "expr" && info.tagName === "include",
    extends: info.tagType === "expr" && info.tagName === "extends",
    block: info.tagType === "expr" && info.tagName === "block",
    endblock: info.tagType === "expr" && info.tagName === "endblock",
    blockName: info.tagType === "expr" && info.tagName === "block" ? info.args.join(" ").trim() : undefined,
    superTag: info.tagType === "filter" && info.tagValue.trim() === "block.super"
  };
}

function writeTag(superTag: boolean, existingBlock: BlockInfo | undefined, blocksToClose: number, omitCloseTag: boolean | undefined): boolean {
  return superTag || (!existingBlock && blocksToClose > (omitCloseTag ? 1 : 0));
}

function processIncludes(tagStr: string, blocks: Blocks, opts: RenderOptions): string {
  const params = splitIncludeTag(tagStr, opts);
  const source = (params[0] ?? "").replace(/"/g, "");
  const defaults = parseDefaults(params.slice(2));
  return preprocessTemplateFile(source, opts, blocks, defaults);
}

export function consumeBlock(scanner: Scanner, opts: RenderOptions, buf?: Buffer, blocks: Blocks = {}, omitCloseTag = false): boolean {
  let blocksToClose = 1;
  let hasSuper = false;
  const d = scanner.delimiters;

  while (blocksToClose > 0 && !scanner.eof()) {
    if (startsTag(scanner)) {
      const tagStr = scanner.readTagContent();
      const tag = classifyTag(tagStr, d);
      const existingBlock = tag.blockName ? blocks[tag.blockName] : undefined;

      if (buf) {
        if (tag.include) buf.append(processIncludes(tagStr, blocks, opts));
        else if (writeTag(tag.superTag, existingBlock, blocksToClose, omitCloseTag)) buf.append(tagStr);
      }

      if (existingBlock && tag.blockName) {
        consumeBlock(scanner, opts);
        const nestedBlocks = { ...blocks };
        delete nestedBlocks[tag.blockName];
        consumeBlock(new Scanner(existingBlock.content, d), opts, buf, nestedBlocks);
      } else if (tag.block) {
        blocksToClose += 1;
      } else if (tag.endblock) {
        blocksToClose -= 1;
      }
      hasSuper = hasSuper || tag.superTag;
    } else {
      const ch = scanner.readChar();
      buf?.append(ch);
    }
  }
  return hasSuper;
}

export function rewriteSuper(block: string, parentContent: string, opts: RenderOptions = {}): string {
  const d = makeDelimiters(opts);
  const superTag = `${escapeRegExp(variableOpen(d))}\\s*block\\.super\\s*${escapeRegExp(variableClose(d))}`;
  return block.replace(new RegExp(superTag, "g"), parentContent);
}

export function readBlock(scanner: Scanner, blockTag: string, blocks: Blocks, opts: RenderOptions): Blocks {
  const d = scanner.delimiters;
  const blockName = classifyTag(blockTag, d).blockName ?? "";
  const existingBlock = blocks[blockName];
  if (existingBlock?.super) {
    const childContent = existingBlock.content;
    const parentContent = new Buffer();
    const hasSuper = consumeBlock(scanner, opts, parentContent, blocks, true);
    return { ...blocks, [blockName]: { super: hasSuper, content: rewriteSuper(childContent, parentContent.toString(), opts) } };
  }
  if (existingBlock) {
    consumeBlock(scanner, opts);
    return blocks;
  }
  const buf = new Buffer();
  buf.append(blockTag);
  const hasSuper = consumeBlock(scanner, opts, buf, blocks);
  return { ...blocks, [blockName]: { super: hasSuper, content: buf.toString() } };
}

export function processBlock(scanner: Scanner, buf: Buffer, blockTag: string, blocks: Blocks, opts: RenderOptions): void {
  const d = scanner.delimiters;
  const blockName = classifyTag(blockTag, d).blockName ?? "";
  const childContent = blocks[blockName]?.content;
  if (childContent != null) {
    const parent = new Buffer();
    consumeBlock(scanner, opts, parent, blocks, true);
    buf.append(rewriteSuper(childContent, parent.toString(), opts));
  } else {
    buf.append(blockTag);
    consumeBlock(scanner, opts, buf, blocks);
  }
}

export function wrapInExpressionTag(s: string, opts: RenderOptions = {}): string {
  const d = makeDelimiters(opts);
  return `${expressionOpen(d)}${s}${expressionClose(d)}`;
}

export function wrapInVariableTag(s: string, opts: RenderOptions = {}): string {
  const d = makeDelimiters(opts);
  return `${variableOpen(d)}${s}${variableClose(d)}`;
}

export function trimVariableTag(s: string, opts: RenderOptions = {}): string {
  return tagInnerContent(s, makeDelimiters(opts));
}

export function trimExpressionTag(s: string, opts: RenderOptions = {}): string {
  return tagInnerContent(s, makeDelimiters(opts));
}

function unparseDefaults(defaults: Defaults): string | undefined {
  if (!defaults) return undefined;
  return Object.entries(defaults).map(([k, v]) => `${k}="${v}"`).join(" ").trim();
}

export function toExpressionString(tagName: string, args: string[], defaults: Defaults, opts: RenderOptions = {}): string {
  const defaultsString = tagName === "include" ? unparseDefaults(defaults) : undefined;
  const joined = `${tagName}${args.length > 0 ? ` ${args.join(" ")}` : ""}${defaultsString ? ` with ${defaultsString}` : ""}`;
  return wrapInExpressionTag(joined, opts);
}

export function addDefault(identifier: string, defaultValue: string): string {
  return `${identifier}|default:"${defaultValue}"`;
}

export function tryAddDefault(identifier: string, defaults: Defaults): string {
  return defaults?.[identifier] != null ? addDefault(identifier, defaults[identifier]) : identifier;
}

export function addDefaultsToVariableTag(tagStr: string, defaults: Defaults, opts: RenderOptions = {}): string {
  return wrapInVariableTag(tryAddDefault(trimVariableTag(tagStr, opts), defaults), opts);
}

export function addDefaultsToExpressionTag(tagStr: string, defaults: Defaults, opts: RenderOptions = {}): string {
  const d = makeDelimiters(opts);
  const info = tagInfo(tagStr, d);
  if (info.tagType !== "expr") return tagStr;
  const args = info.args.map((arg) => tryAddDefault(arg, defaults));
  return toExpressionString(info.tagName, args, defaults, opts);
}

export function preprocessTemplateString(template: string, opts: RenderOptions = {}, blocks?: Blocks, defaults?: Defaults): string {
  return readTemplate(template, opts, blocks, defaults, true);
}

export function preprocessTemplateFile(template: string | URL, opts: RenderOptions = {}, blocks?: Blocks, defaults?: Defaults): string {
  return readTemplate(template, opts, blocks, defaults, false);
}

export function preprocessTemplate(template: string | URL, opts: RenderOptions = {}): string {
  return typeof template === "string" && template.includes("\n") ? preprocessTemplateString(template, opts) : preprocessTemplateFile(template, opts);
}

function readTemplate(template: string | URL, opts: RenderOptions, blocks: Blocks = {}, defaults?: Defaults, stringMode = false): string {
  const d = makeDelimiters(opts);
  const source = stringMode ? String(template) : readTemplateFile(template, opts);
  const scanner = new Scanner(source, d);
  const buf = new Buffer();
  let parent: string | undefined;
  let currentBlocks = blocks;

  while (!scanner.eof()) {
    if (startsTag(scanner)) {
      const tagStr = scanner.readTagContent();
      const tag = classifyTag(tagStr, d);
      if (defaults && tag.info.tagType === "filter") {
        buf.append(addDefaultsToVariableTag(tagStr, defaults, opts));
      } else if (defaults && tag.info.tagType === "expr" && !tag.include) {
        buf.append(addDefaultsToExpressionTag(tagStr, defaults, opts));
      } else if (defaults && tag.include) {
        buf.append(processIncludes(addDefaultsToExpressionTag(tagStr, defaults, opts), currentBlocks, opts));
      } else if (tag.include) {
        buf.append(processIncludes(tagStr, currentBlocks, opts));
      } else if (tag.extends) {
        parent = getParent(tagStr, opts);
      } else if (parent && tag.block) {
        currentBlocks = readBlock(scanner, tagStr, currentBlocks, opts);
      } else if (tag.block) {
        processBlock(scanner, buf, tagStr, currentBlocks, opts);
      } else if (!parent) {
        buf.append(tagStr);
      }
    } else {
      const ch = scanner.readChar();
      if (!parent) buf.append(ch);
    }
  }

  return parent ? readTemplate(parent, opts, currentBlocks, defaults, false) : buf.toString();
}

function readTemplateFile(template: string | URL, opts: RenderOptions): string {
  validate(template, opts);
  return readResource(template, opts).content;
}

function startsTag(scanner: Scanner): boolean {
  const d = scanner.delimiters;
  return scanner.startsWith(d.tagOpen + d.filterOpen) || scanner.startsWith(d.tagOpen + d.tagSecond);
}
