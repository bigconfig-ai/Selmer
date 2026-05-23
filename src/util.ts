import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AccessorKey, AccessorPath, Context, Delimiters, RenderOptions, TagInfo } from "./types.js";

export const defaultDelimiters: Delimiters = {
  tagOpen: "{",
  tagClose: "}",
  filterOpen: "{",
  filterClose: "}",
  tagSecond: "%",
  shortCommentSecond: "#"
};

export function makeDelimiters(opts: RenderOptions = {}): Delimiters {
  return {
    tagOpen: opts.tagOpen ?? defaultDelimiters.tagOpen,
    tagClose: opts.tagClose ?? defaultDelimiters.tagClose,
    filterOpen: opts.filterOpen ?? defaultDelimiters.filterOpen,
    filterClose: opts.filterClose ?? defaultDelimiters.filterClose,
    tagSecond: opts.tagSecond ?? defaultDelimiters.tagSecond,
    shortCommentSecond: opts.shortCommentSecond ?? defaultDelimiters.shortCommentSecond
  };
}

export function variableOpen(d: Delimiters): string {
  return d.tagOpen + d.filterOpen;
}

export function variableClose(d: Delimiters): string {
  return d.filterClose + d.tagClose;
}

export function expressionOpen(d: Delimiters): string {
  return d.tagOpen + d.tagSecond;
}

export function expressionClose(d: Delimiters): string {
  return d.tagSecond + d.tagClose;
}

export function shortCommentOpen(d: Delimiters): string {
  return d.tagOpen + d.shortCommentSecond;
}

export function shortCommentClose(d: Delimiters): string {
  return d.shortCommentSecond + d.tagClose;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pattern(...content: unknown[]): RegExp {
  return new RegExp(content.join(""));
}

let customResourcePath: string | null = null;
let resourceLoader: ((path: string) => string | undefined | null) | undefined;
let escapeVariables = true;
let warnOnDeprecatedKeys = true;
let deprecationWarningHandler: (message: string) => void = (message) => {
  process.stderr.write(`DEPRECATION WARNING: ${message}\n`);
};
const warnedKeys = new Set<string>();

export type MissingValueFormatter = (tag: TagInfo | { tagName?: string; tagValue?: string; args?: AccessorPath | string[] }, context: Context) => unknown;
export const defaultMissingValueFormatter: MissingValueFormatter = () => "";
let missingValueFormatter: MissingValueFormatter = defaultMissingValueFormatter;
let filterMissingValues = true;

export function getCustomResourcePath(): string | null {
  return customResourcePath;
}

export function setCustomResourcePath(path: string | URL | null | undefined): void {
  customResourcePath = makeResourcePath(path ?? null);
}

export const setCustomResourcePath$ = setCustomResourcePath;

export function setResourceLoader(loader: ((path: string) => string | undefined | null) | undefined): void {
  resourceLoader = loader;
}

export function getResourceLoader(): ((path: string) => string | undefined | null) | undefined {
  return resourceLoader;
}

export function turnOffEscaping(): void {
  escapeVariables = false;
}

export function turnOnEscaping(): void {
  escapeVariables = true;
}

export function isEscapingVariables(): boolean {
  return escapeVariables;
}

export function withEscaping<T>(fn: () => T): T {
  const previous = escapeVariables;
  escapeVariables = true;
  try {
    return fn();
  } finally {
    escapeVariables = previous;
  }
}

export function withoutEscaping<T>(fn: () => T): T {
  const previous = escapeVariables;
  escapeVariables = false;
  try {
    return fn();
  } finally {
    escapeVariables = previous;
  }
}

export function getMissingValueFormatter(): MissingValueFormatter {
  return missingValueFormatter;
}

export function shouldFilterMissingValues(): boolean {
  return filterMissingValues;
}

export function setMissingValueFormatter(
  formatter: MissingValueFormatter,
  opts: { filterMissingValues?: boolean } = {}
): void {
  missingValueFormatter = formatter;
  filterMissingValues = opts.filterMissingValues ?? false;
}

export function resetMissingValueFormatter(): void {
  missingValueFormatter = defaultMissingValueFormatter;
  filterMissingValues = true;
}

export function setWarnOnDeprecatedKeys(value: boolean): void {
  warnOnDeprecatedKeys = value;
}

export function setDeprecationWarningHandler(handler: (message: string) => void): void {
  deprecationWarningHandler = handler;
}

export function resetDeprecatedKeyWarnings(): void {
  warnedKeys.clear();
}

export function deprecatedKeyLookup(context: Context, namespacedKey: string, nonNamespacedKey: string): unknown {
  const namespaced = getOwn(context, namespacedKey);
  if (namespaced.found) return namespaced.value;
  const nonNamespaced = getOwn(context, nonNamespacedKey);
  if (nonNamespaced.found) {
    if (warnOnDeprecatedKeys && !warnedKeys.has(nonNamespacedKey)) {
      warnedKeys.add(nonNamespacedKey);
      deprecationWarningHandler(
        `Using :${nonNamespacedKey} in context is deprecated. Please use :${namespacedKey} instead.`
      );
    }
    return nonNamespaced.value;
  }
  return undefined;
}

export function appendSlash(s: string | null): string | null {
  if (s == null || s.endsWith("/")) return s;
  return `${s}/`;
}

export function makeResourcePath(path: string | URL | null): string | null {
  if (path == null) return null;
  if (path instanceof URL) {
    if (path.protocol === "file:") return appendSlash(fileURLToPath(path));
    return appendSlash(String(path));
  }
  if (path.startsWith("file:")) return appendSlash(fileURLToPath(path));
  return appendSlash(path);
}

export function setResourcePath(path: string | URL | null): void {
  setCustomResourcePath(path);
}

export function looksLikeAbsoluteFilePath(path: string): boolean {
  return isAbsolute(path) || /^[a-zA-Z]:/.test(path);
}

export interface ResolvedResource {
  path: string;
  displayPath: string;
  content?: string;
  lastModified: number;
}

function pathCandidates(template: string, base?: string | null): string[] {
  const candidates: string[] = [];
  if (base) candidates.push(join(base, template));
  if (looksLikeAbsoluteFilePath(template)) candidates.push(template);
  candidates.push(resolve(template));
  candidates.push(resolve("test", template));
  candidates.push(resolve("resources", template));
  if (template.startsWith("templates/")) candidates.push(resolve("test", template));
  return [...new Set(candidates)];
}

export function resourcePath(template: string | URL, opts: RenderOptions = {}): ResolvedResource | undefined {
  if (template instanceof URL) {
    if (template.protocol !== "file:") {
      const loader = opts.resourceLoader ?? resourceLoader;
      const content = loader?.(String(template));
      if (content != null) return { path: String(template), displayPath: String(template), content, lastModified: -1 };
      return undefined;
    }
    const path = fileURLToPath(template);
    return existsSync(path) ? { path, displayPath: path, lastModified: statSync(path).mtimeMs } : undefined;
  }

  const loader = opts.resourceLoader ?? resourceLoader;
  const base = makeResourcePath(opts.customResourcePath ?? customResourcePath);
  if (loader) {
    const logical = base ? `${base}${template}` : template;
    const content = loader(logical) ?? loader(template);
    if (content != null) return { path: logical, displayPath: logical, content, lastModified: -1 };
  }

  for (const candidate of pathCandidates(template, base)) {
    if (existsSync(candidate)) {
      const st = statSync(candidate);
      return { path: candidate, displayPath: candidate, lastModified: st.mtimeMs };
    }
  }
  return undefined;
}

export function readResource(template: string | URL, opts: RenderOptions = {}): { content: string; resource: ResolvedResource } {
  const resource = resourcePath(template, opts);
  if (!resource) {
    throw new Error(
      `resource-path for ${String(template)} returned nil, typically means the file doesn't exist in your classpath.`
    );
  }
  const content = resource.content ?? readFileSync(resource.path, "utf8");
  return { content, resource };
}

export function resourceLastModified(template: string | URL, opts: RenderOptions = {}): number {
  return resourcePath(template, opts)?.lastModified ?? -1;
}

export function checkTemplateExists(template: string | URL, opts: RenderOptions = {}): void {
  if (!resourcePath(template, opts)) throw new Error(`template: "${String(template)}" not found`);
}

export function getOwn(context: Context | unknown, key: AccessorKey): { found: boolean; value: unknown } {
  if (context == null) return { found: false, value: undefined };
  if (context instanceof Map) {
    if (context.has(key)) return { found: true, value: context.get(key) };
    if (typeof key === "string") {
      if (context.has(`:${key}`)) return { found: true, value: context.get(`:${key}`) };
      if (key.startsWith(":")) {
        const noColon = key.slice(1);
        if (context.has(noColon)) return { found: true, value: context.get(noColon) };
      }
    }
    return { found: false, value: undefined };
  }
  if (Array.isArray(context) && typeof key === "number") {
    return key >= 0 && key < context.length ? { found: true, value: context[key] } : { found: false, value: undefined };
  }
  if (typeof context === "object") {
    const obj = context as Record<string, unknown>;
    const keys = typeof key === "number" ? [String(key)] : keyAlternatives(key);
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) return { found: true, value: obj[k] };
    }
  }
  return { found: false, value: undefined };
}

function keyAlternatives(key: string): string[] {
  const alts = [key];
  if (key.startsWith(":")) alts.push(key.slice(1));
  else alts.push(`:${key}`);
  const slash = key.lastIndexOf("/");
  if (slash >= 0) alts.push(key.slice(slash + 1));
  return [...new Set(alts)];
}

export function getAccessor(m: unknown, k: AccessorKey): unknown {
  return getOwn(m, k).value;
}

export function getIn(context: Context | unknown, path: AccessorPath): unknown {
  return path.reduce((acc: unknown, key) => getAccessor(acc, key), context as unknown);
}

export function assocIn<T extends Context>(context: T, path: AccessorPath, value: unknown): T {
  if (path.length === 0) return context;
  const root = cloneContext(context) as Record<string, unknown>;
  let current: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = String(path[i]);
    const existing = current[key];
    const next = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as object) } : {};
    current[key] = next;
    current = next as Record<string, unknown>;
  }
  current[String(path[path.length - 1])] = value;
  return root as T;
}

export function cloneContext(context: Context): Context {
  if (context instanceof Map) return new Map(context);
  return { ...(context as Record<string, unknown>) };
}

function parseLongValue(s: string): number | undefined {
  return /^\d+$/.test(s) ? Number.parseInt(s, 10) : undefined;
}

export function parseAccessor(accessor: string): AccessorPath {
  if (accessor == null || accessor === "") return [];
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < accessor.length; i += 1) {
    const ch = accessor[i];
    if (ch === ".") {
      if (accessor[i + 1] === ".") {
        buf += ".";
        i += 1;
      } else {
        parts.push(buf);
        buf = "";
      }
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts.map((part) => parseLongValue(part) ?? stripKeywordPrefix(part));
}

function stripKeywordPrefix(s: string): string {
  return s.startsWith(":") ? s.slice(1) : s;
}

export function splitByArgs(s: string): string[] {
  const items: string[] = [];
  let buf = "";
  let open = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (open && ch === '"') {
      const value = buf.trim();
      buf = "";
      items.push(value);
      open = false;
    } else if (ch === '"') {
      open = true;
    } else if (!open && ch === "=") {
      const id = buf.trim();
      buf = "";
      items.push(id);
    } else {
      buf += ch;
    }
  }
  return items.filter((x) => x !== "");
}

export function ffind<T>(f: (value: T) => boolean, coll: Iterable<T>): T | undefined {
  for (const value of coll) if (f(value)) return value;
  return undefined;
}

export function hex(algo: string, s: string): string {
  const normalized = (() => {
    switch (algo) {
      case "md5":
        return "md5";
      case "sha":
        return "sha1";
      case "sha256":
        return "sha256";
      case "sha384":
        return "sha384";
      case "sha512":
        return "sha512";
      default:
        throw new Error(`'${algo}' is not a valid hash algorithm.`);
    }
  })();
  return createHash(normalized).update(s).digest("hex");
}

export function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function isIterable(value: unknown): value is Iterable<unknown> {
  return value != null && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function";
}

export function seq(value: unknown): unknown[] {
  if (isNil(value)) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [...value];
  if (value instanceof Map) return [...value.entries()];
  if (value instanceof Set) return [...value.values()];
  if (isIterable(value)) return [...value];
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>);
  throw new Error(`Expected '${String(value)}' to be a collection of some sort.`);
}

export function count(value: unknown): number {
  if (isNil(value)) return 0;
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value instanceof Map || value instanceof Set) return value.size;
  if (isIterable(value)) return [...value].length;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  throw new Error(`Expected '${String(value)}' to be a collection of some sort.`);
}

export function isEmpty(value: unknown): boolean {
  return count(value) === 0;
}

export function notEmpty<T>(value: T): T | undefined {
  return isEmpty(value) ? undefined : value;
}

export function cljStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(prStr).join(" ")}]`;
  if (value instanceof Set) return `#{${[...value].map(prStr).join(" ")}}`;
  if (value instanceof Map) return `{${[...value.entries()].map(([k, v]) => `${prStrKey(k)} ${prStr(v)}`).join(", ")}}`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries.map(([k, v]) => `${prStrKey(k)} ${prStr(v)}`).join(", ")}}`;
  }
  return String(value);
}

export function prStr(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith(":")) return value;
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return cljStr(value);
}

function prStrKey(key: unknown): string {
  if (typeof key === "string") return key.startsWith(":") ? key : `:${key}`;
  return prStr(key);
}

export function projectRootFromImportMeta(metaUrl: string): string {
  return dirname(dirname(fileURLToPath(metaUrl)));
}

export function toFileUrl(path: string): URL {
  return pathToFileURL(path);
}
