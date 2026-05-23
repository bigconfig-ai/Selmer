import { statSync } from "node:fs";
import { FunctionNode, TextNode } from "./node.js";
import type {
  Context,
  ExprTagHandler,
  FunctionHandler,
  ParsedTemplate,
  RenderFunction,
  RenderOptions,
  ScannerLike,
  TagContentBlock,
  TagContentMap,
  TagInfo,
  TemplateNode
} from "./types.js";
import { compileFilterBody, literal, parseLiteral } from "./filter-parser.js";
import { addFilter } from "./filters.js";
import { exprTags } from "./tags.js";
import {
  cljStr,
  getMissingValueFormatter,
  makeDelimiters,
  parseAccessor,
  readResource,
  resourcePath,
  setResourcePath as setResourcePathUtil
} from "./util.js";
import { Scanner } from "./scanner.js";
import { preprocessTemplateFile, preprocessTemplateString } from "./template-parser.js";

interface CachedTemplate {
  template: ParsedTemplate;
  lastModified: number;
}

const templates = new Map<string, CachedTemplate>();
let cacheEnabled = true;

export { templates };

export function clearCache(): void {
  templates.clear();
}

export const clearCache$ = clearCache;

export function cacheOn(): void {
  cacheEnabled = true;
}

export const cacheOn$ = cacheOn;

export function cacheOff(): void {
  clearCache();
  cacheEnabled = false;
}

export const cacheOff$ = cacheOff;

export function setResourcePath(path: string | URL | null): void {
  setResourcePathUtil(path);
}

export const setResourcePath$ = setResourcePath;

export function addFilter$ForParser(name: string, fn: Parameters<typeof addFilter>[1]): void {
  addFilter(name, fn);
}

export { addFilter as addFilter };

function applyCustoms(opts: RenderOptions = {}): void {
  if (opts.customTags) {
    for (const [name, handler] of Object.entries(opts.customTags)) exprTags.set(name.startsWith(":") ? name.slice(1) : name, handler);
  }
  if (opts.customFilters) {
    for (const [name, handler] of Object.entries(opts.customFilters)) addFilter(name, handler);
  }
}

export function renderTemplate(template: TemplateNode[], context: Context): string {
  let output = "";
  for (const element of template) {
    const value = element.renderNode(context);
    if (value === undefined || value === null) {
      const tag = element instanceof FunctionNode ? element.meta?.tag : undefined;
      output += cljStr(getMissingValueFormatter()(tag ?? { tagValue: undefined }, context));
    } else {
      output += cljStr(value);
    }
  }
  return output;
}

export const renderTemplate$ = renderTemplate;

export function render(s: string, context: Context = {}, opts: RenderOptions = {}): string {
  return renderTemplate(parseString(s, opts), context);
}

export function renderFile(filenameOrUrl: string | URL, context: Context = {}, opts: RenderOptions = {}): string {
  const useCache = opts.cache ?? cacheEnabled;
  const resource = resourcePath(filenameOrUrl, opts);
  if (!resource) {
    throw new Error(
      `resource-path for ${String(filenameOrUrl)} returned nil, typically means the file doesn't exist in your classpath.`
    );
  }
  const lastModified = resource.lastModified >= 0 ? resource.lastModified : statSafe(resource.path);
  const cached = templates.get(resource.path);
  if (useCache && cached && cached.lastModified === lastModified) return renderTemplate(cached.template, context);
  const template = parseFile(filenameOrUrl, opts);
  templates.set(resource.path, { template, lastModified });
  return renderTemplate(template, context);
}

function statSafe(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

export function parseString(input: string, opts: RenderOptions = {}): ParsedTemplate {
  return compileSource(preprocessTemplateString(input, opts), opts);
}

export function parseFile(file: string | URL, opts: RenderOptions = {}): ParsedTemplate {
  return compileSource(preprocessTemplateFile(file, opts), opts);
}

export function parseInput(input: string, opts: RenderOptions = {}): ParsedTemplate {
  const delimiters = makeDelimiters(opts);
  const source = shouldTreatInputAsPath(input, opts, delimiters) ? readResource(input, opts).content : input;
  return compileSource(source, opts, delimiters);
}

function compileSource(source: string, opts: RenderOptions, delimiters = makeDelimiters(opts)): ParsedTemplate {
  applyCustoms(opts);
  const tags: TagInfo[] = [];
  const scanner = new Scanner(source, delimiters, tags);
  const parsed = parseScanner(scanner, opts, tags) as ParsedTemplate;
  parsed.allTags = tags;
  return parsed;
}

export function parse(parseFn: (input: string, opts?: RenderOptions) => ParsedTemplate, input: string, opts: RenderOptions = {}): ParsedTemplate {
  return parseFn(input, opts);
}

function shouldTreatInputAsPath(input: string, opts: RenderOptions, delimiters: ReturnType<typeof makeDelimiters>): boolean {
  if (input.includes("\n")) return false;
  if (input.includes(delimiters.tagOpen + delimiters.filterOpen) || input.includes(delimiters.tagOpen + delimiters.tagSecond)) return false;
  return Boolean(resourcePath(input, opts));
}

function parseScanner(scanner: ScannerLike, opts: RenderOptions, tags: TagInfo[]): TemplateNode[] {
  const template: TemplateNode[] = [];
  let buf = "";
  while (!scanner.eof()) {
    if (startsShortComment(scanner)) {
      scanner.skipShortComment();
      continue;
    }
    if (startsTag(scanner)) {
      if (buf.length > 0) {
        template.push(new TextNode(buf));
        buf = "";
      }
      const tag = scanner.readTagInfo();
      template.push(new FunctionNode(parseTag(tag, scanner, opts, tags)));
    } else {
      buf += scanner.readChar() ?? "";
    }
  }
  template.push(new TextNode(buf));
  return template;
}

function startsTag(scanner: ScannerLike): boolean {
  const d = scanner.delimiters;
  return scanner.startsWith(d.tagOpen + d.filterOpen) || scanner.startsWith(d.tagOpen + d.tagSecond);
}

function startsShortComment(scanner: ScannerLike): boolean {
  const d = scanner.delimiters;
  return scanner.startsWith(d.tagOpen + d.shortCommentSecond);
}

export function exprTag(tag: Extract<TagInfo, { tagType: "expr" }>, scanner: ScannerLike, opts: RenderOptions, tags: TagInfo[]): FunctionHandler {
  const handler = exprTags.get(tag.tagName);
  if (!handler) throw new Error(`unrecognized tag: ${tag.tagName} - did you forget to close a tag?`);
  return handler(tag.args, (s, start, ...end) => tagContent(s, start, opts, tags, ...end), renderTemplate as RenderFunction, scanner) as FunctionHandler;
}

export function filterTag(tag: Extract<TagInfo, { tagType: "filter" }>): FunctionHandler {
  return compileFilterBody(tag.tagValue) as FunctionHandler;
}

export function parseTag(tag: TagInfo, scanner: ScannerLike, opts: RenderOptions, tags: TagInfo[]): FunctionHandler {
  const handler = tag.tagType === "filter" ? filterTag(tag) : exprTag(tag, scanner, opts, tags);
  handler.meta = { tag };
  return handler;
}

function appendNode(content: TemplateNode[], tag: TagInfo, buf: string, scanner: ScannerLike, opts: RenderOptions, tags: TagInfo[]): TemplateNode[] {
  return [...content, new TextNode(buf), new FunctionNode(parseTag(tag, scanner, opts, tags))];
}

function ensureList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function updateTags(tag: string, tagsMap: TagContentMap, content: TemplateNode[], args: string[] | undefined, buf: string): TagContentMap {
  const block: TagContentBlock = { args, content: [...content, new TextNode(buf)] };
  const existing = tagsMap[tag];
  if (existing) return { ...tagsMap, [tag]: [...ensureList(existing as TagContentBlock | TagContentBlock[]), block] };
  return { ...tagsMap, [tag]: block };
}

export function tagContent(scanner: ScannerLike, startTag: string, opts: RenderOptions, allTags: TagInfo[], ...endTags0: string[]): TagContentMap {
  let tagsMap: TagContentMap = {};
  let content: TemplateNode[] = [];
  let curTag = startTag;
  let endTags = [...endTags0];
  let curArgs: string[] | undefined;
  let buf = "";

  while (true) {
    if (scanner.eof()) {
      if (endTags.length > 0) throw new Error(`No closing tag found for ${startTag}`);
      return tagsMap;
    }
    if (startsShortComment(scanner)) {
      scanner.skipShortComment();
      continue;
    }
    if (startsTag(scanner)) {
      const tag = scanner.readTagInfo();
      const tagName = tag.tagType === "expr" ? tag.tagName : undefined;
      const endIndex = tagName == null ? -1 : endTags.indexOf(tagName);
      if (endIndex >= 0 && tagName) {
        tagsMap = updateTags(curTag, tagsMap, content, curArgs, buf);
        buf = "";
        content = [];
        curTag = tagName;
        curArgs = tag.tagType === "expr" ? tag.args : undefined;
        if (tagName !== "elif") endTags = endTags.slice(endIndex + 1);
        if (endTags.length === 0) return tagsMap;
      } else {
        content = appendNode(content, tag, buf, scanner, opts, allTags);
        buf = "";
      }
    } else {
      buf += scanner.readChar() ?? "";
    }
  }
}

function parseVariablePaths(arg: string): ReturnType<typeof parseAccessor> | undefined {
  const value = splitValueLocal(arg)[0];
  return value ? parseAccessor(value) : undefined;
}

function splitValueLocal(s: string): string[] {
  const result: string[] = [];
  let buf = "";
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "|") {
      result.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  result.push(buf.trim());
  return result.filter(Boolean);
}

function pathKey(path: ReturnType<typeof parseAccessor>): string {
  return JSON.stringify(path);
}

function parseVariables(tags: TagInfo[]): ReturnType<typeof parseAccessor>[] {
  const vars = new Map<string, ReturnType<typeof parseAccessor>>();
  let nestedKeys = new Set<string | number>();
  const add = (path: ReturnType<typeof parseAccessor> | undefined) => {
    if (path && path.length > 0) vars.set(pathKey(path), path);
  };
  for (const tag of tags) {
    if (tag.tagType === "filter") {
      const v = parseVariablePaths(tag.tagValue);
      if (v && !nestedKeys.has(v[0])) add(v);
    } else if (tag.tagName === "for") {
      const [ids, inPart] = aggregateArgsLocal(tag.args);
      add(parseVariablePaths(inPart[1] ?? ""));
      nestedKeys = new Set([...ids.map((id) => parseAccessor(id)[0]), "forloop"]);
    } else if (tag.tagName === "with") {
      const [id, value] = (tag.args[0] ?? "").split("=");
      add(parseVariablePaths(value));
      nestedKeys = new Set([parseAccessor(id)[0]]);
    } else if (tag.tagName === "endfor" || tag.tagName === "endwith") {
      nestedKeys = new Set();
    } else {
      const special = new Set<unknown>([undefined, "not", "all", "any", "<", ">", "=", "<=", ">="]);
      for (const arg of tag.args) {
        if (literal(arg)) continue;
        const v = parseVariablePaths(arg);
        if (!v || special.has(v[0]) || nestedKeys.has(v[0])) continue;
        add(v);
      }
    }
  }
  return [...vars.values()];
}

function aggregateArgsLocal(args: string[]): [string[], ["in", string]] {
  const split = args.flatMap((arg) => arg.split(",")).filter((arg) => arg !== "");
  const idx = split.indexOf("in");
  return [split.slice(0, idx), ["in", split[idx + 1]]];
}

export function knownVariablePaths(input: string, opts: RenderOptions = {}): ReturnType<typeof parseAccessor>[] {
  const parsed = parseInput(input, opts);
  return parseVariables(parsed.allTags ?? []);
}

export function knownVariables(input: string, opts: RenderOptions = {}): Set<string | number> {
  return new Set(knownVariablePaths(input, opts).map((path) => path[0]));
}

export function resolveArg(arg: string, context: Context): unknown {
  if (literal(arg)) return parseLiteral(arg);
  return render(arg, context);
}

export { readResource };
