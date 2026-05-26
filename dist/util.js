import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
export const defaultDelimiters = {
    tagOpen: "{",
    tagClose: "}",
    filterOpen: "{",
    filterClose: "}",
    tagSecond: "%",
    shortCommentSecond: "#"
};
export function makeDelimiters(opts = {}) {
    return {
        tagOpen: opts.tagOpen ?? defaultDelimiters.tagOpen,
        tagClose: opts.tagClose ?? defaultDelimiters.tagClose,
        filterOpen: opts.filterOpen ?? defaultDelimiters.filterOpen,
        filterClose: opts.filterClose ?? defaultDelimiters.filterClose,
        tagSecond: opts.tagSecond ?? defaultDelimiters.tagSecond,
        shortCommentSecond: opts.shortCommentSecond ?? defaultDelimiters.shortCommentSecond
    };
}
export function variableOpen(d) {
    return d.tagOpen + d.filterOpen;
}
export function variableClose(d) {
    return d.filterClose + d.tagClose;
}
export function expressionOpen(d) {
    return d.tagOpen + d.tagSecond;
}
export function expressionClose(d) {
    return d.tagSecond + d.tagClose;
}
export function shortCommentOpen(d) {
    return d.tagOpen + d.shortCommentSecond;
}
export function shortCommentClose(d) {
    return d.shortCommentSecond + d.tagClose;
}
export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function pattern(...content) {
    return new RegExp(content.join(""));
}
let customResourcePath = null;
let resourceLoader;
let escapeVariables = true;
let warnOnDeprecatedKeys = true;
let deprecationWarningHandler = (message) => {
    process.stderr.write(`DEPRECATION WARNING: ${message}\n`);
};
const warnedKeys = new Set();
export const defaultMissingValueFormatter = () => "";
let missingValueFormatter = defaultMissingValueFormatter;
let filterMissingValues = true;
export function getCustomResourcePath() {
    return customResourcePath;
}
export function setCustomResourcePath(path) {
    customResourcePath = makeResourcePath(path ?? null);
}
export const setCustomResourcePath$ = setCustomResourcePath;
export function setResourceLoader(loader) {
    resourceLoader = loader;
}
export function getResourceLoader() {
    return resourceLoader;
}
export function turnOffEscaping() {
    escapeVariables = false;
}
export function turnOnEscaping() {
    escapeVariables = true;
}
export function isEscapingVariables() {
    return escapeVariables;
}
export function withEscaping(fn) {
    const previous = escapeVariables;
    escapeVariables = true;
    try {
        return fn();
    }
    finally {
        escapeVariables = previous;
    }
}
export function withoutEscaping(fn) {
    const previous = escapeVariables;
    escapeVariables = false;
    try {
        return fn();
    }
    finally {
        escapeVariables = previous;
    }
}
export function getMissingValueFormatter() {
    return missingValueFormatter;
}
export function shouldFilterMissingValues() {
    return filterMissingValues;
}
export function setMissingValueFormatter(formatter, opts = {}) {
    missingValueFormatter = formatter;
    filterMissingValues = opts.filterMissingValues ?? false;
}
export function resetMissingValueFormatter() {
    missingValueFormatter = defaultMissingValueFormatter;
    filterMissingValues = true;
}
export function setWarnOnDeprecatedKeys(value) {
    warnOnDeprecatedKeys = value;
}
export function setDeprecationWarningHandler(handler) {
    deprecationWarningHandler = handler;
}
export function resetDeprecatedKeyWarnings() {
    warnedKeys.clear();
}
export function deprecatedKeyLookup(context, namespacedKey, nonNamespacedKey) {
    const namespaced = getOwn(context, namespacedKey);
    if (namespaced.found)
        return namespaced.value;
    const nonNamespaced = getOwn(context, nonNamespacedKey);
    if (nonNamespaced.found) {
        if (warnOnDeprecatedKeys && !warnedKeys.has(nonNamespacedKey)) {
            warnedKeys.add(nonNamespacedKey);
            deprecationWarningHandler(`Using :${nonNamespacedKey} in context is deprecated. Please use :${namespacedKey} instead.`);
        }
        return nonNamespaced.value;
    }
    return undefined;
}
export function appendSlash(s) {
    if (s == null || s.endsWith("/"))
        return s;
    return `${s}/`;
}
export function makeResourcePath(path) {
    if (path == null)
        return null;
    if (path instanceof URL) {
        if (path.protocol === "file:")
            return appendSlash(fileURLToPath(path));
        return appendSlash(String(path));
    }
    if (path.startsWith("file:"))
        return appendSlash(fileURLToPath(path));
    return appendSlash(path);
}
export function setResourcePath(path) {
    setCustomResourcePath(path);
}
export function looksLikeAbsoluteFilePath(path) {
    return isAbsolute(path) || /^[a-zA-Z]:/.test(path);
}
function pathCandidates(template, base) {
    const candidates = [];
    if (base)
        candidates.push(join(base, template));
    if (looksLikeAbsoluteFilePath(template))
        candidates.push(template);
    candidates.push(resolve(template));
    candidates.push(resolve("test", template));
    candidates.push(resolve("resources", template));
    if (template.startsWith("templates/"))
        candidates.push(resolve("test", template));
    return [...new Set(candidates)];
}
export function resourcePath(template, opts = {}) {
    if (template instanceof URL) {
        if (template.protocol !== "file:") {
            const loader = opts.resourceLoader ?? resourceLoader;
            const content = loader?.(String(template));
            if (content != null)
                return { path: String(template), displayPath: String(template), content, lastModified: -1 };
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
        if (content != null)
            return { path: logical, displayPath: logical, content, lastModified: -1 };
    }
    for (const candidate of pathCandidates(template, base)) {
        if (existsSync(candidate)) {
            const st = statSync(candidate);
            return { path: candidate, displayPath: candidate, lastModified: st.mtimeMs };
        }
    }
    return undefined;
}
export function readResource(template, opts = {}) {
    const resource = resourcePath(template, opts);
    if (!resource) {
        throw new Error(`resource-path for ${String(template)} returned nil, typically means the file doesn't exist in your classpath.`);
    }
    const content = resource.content ?? readFileSync(resource.path, "utf8");
    return { content, resource };
}
export function resourceLastModified(template, opts = {}) {
    return resourcePath(template, opts)?.lastModified ?? -1;
}
export function checkTemplateExists(template, opts = {}) {
    if (!resourcePath(template, opts))
        throw new Error(`template: "${String(template)}" not found`);
}
export function getOwn(context, key) {
    if (context == null)
        return { found: false, value: undefined };
    if (context instanceof Map) {
        if (context.has(key))
            return { found: true, value: context.get(key) };
        if (typeof key === "string") {
            if (context.has(`:${key}`))
                return { found: true, value: context.get(`:${key}`) };
            if (key.startsWith(":")) {
                const noColon = key.slice(1);
                if (context.has(noColon))
                    return { found: true, value: context.get(noColon) };
            }
        }
        return { found: false, value: undefined };
    }
    if (Array.isArray(context) && typeof key === "number") {
        return key >= 0 && key < context.length ? { found: true, value: context[key] } : { found: false, value: undefined };
    }
    if (typeof context === "object") {
        const obj = context;
        const keys = typeof key === "number" ? [String(key)] : keyAlternatives(key);
        for (const k of keys) {
            if (Object.prototype.hasOwnProperty.call(obj, k))
                return { found: true, value: obj[k] };
        }
    }
    return { found: false, value: undefined };
}
function keyAlternatives(key) {
    const alts = [key];
    if (key.startsWith(":"))
        alts.push(key.slice(1));
    else
        alts.push(`:${key}`);
    const slash = key.lastIndexOf("/");
    if (slash >= 0)
        alts.push(key.slice(slash + 1));
    return [...new Set(alts)];
}
export function getAccessor(m, k) {
    return getOwn(m, k).value;
}
export function getIn(context, path) {
    return path.reduce((acc, key) => getAccessor(acc, key), context);
}
export function assocIn(context, path, value) {
    if (path.length === 0)
        return context;
    const root = cloneContext(context);
    let current = root;
    for (let i = 0; i < path.length - 1; i += 1) {
        const key = String(path[i]);
        const existing = current[key];
        const next = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
        current[key] = next;
        current = next;
    }
    current[String(path[path.length - 1])] = value;
    return root;
}
export function cloneContext(context) {
    if (context instanceof Map)
        return new Map(context);
    return { ...context };
}
function parseLongValue(s) {
    return /^\d+$/.test(s) ? Number.parseInt(s, 10) : undefined;
}
export function parseAccessor(accessor) {
    if (accessor == null || accessor === "")
        return [];
    const parts = [];
    let buf = "";
    for (let i = 0; i < accessor.length; i += 1) {
        const ch = accessor[i];
        if (ch === ".") {
            if (accessor[i + 1] === ".") {
                buf += ".";
                i += 1;
            }
            else {
                parts.push(buf);
                buf = "";
            }
        }
        else {
            buf += ch;
        }
    }
    parts.push(buf);
    return parts.map((part) => parseLongValue(part) ?? stripKeywordPrefix(part));
}
function stripKeywordPrefix(s) {
    return s.startsWith(":") ? s.slice(1) : s;
}
export function splitByArgs(s) {
    const items = [];
    let buf = "";
    let open = false;
    for (let i = 0; i < s.length; i += 1) {
        const ch = s[i];
        if (open && ch === '"') {
            const value = buf.trim();
            buf = "";
            items.push(value);
            open = false;
        }
        else if (ch === '"') {
            open = true;
        }
        else if (!open && ch === "=") {
            const id = buf.trim();
            buf = "";
            items.push(id);
        }
        else {
            buf += ch;
        }
    }
    return items.filter((x) => x !== "");
}
export function ffind(f, coll) {
    for (const value of coll)
        if (f(value))
            return value;
    return undefined;
}
export function hex(algo, s) {
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
export function isNil(value) {
    return value === null || value === undefined;
}
export function isIterable(value) {
    return value != null && typeof value[Symbol.iterator] === "function";
}
export function seq(value) {
    if (isNil(value))
        return [];
    if (Array.isArray(value))
        return value;
    if (typeof value === "string")
        return [...value];
    if (value instanceof Map)
        return [...value.entries()];
    if (value instanceof Set)
        return [...value.values()];
    if (isIterable(value))
        return [...value];
    if (typeof value === "object")
        return Object.entries(value);
    throw new Error(`Expected '${String(value)}' to be a collection of some sort.`);
}
export function count(value) {
    if (isNil(value))
        return 0;
    if (typeof value === "string" || Array.isArray(value))
        return value.length;
    if (value instanceof Map || value instanceof Set)
        return value.size;
    if (isIterable(value))
        return [...value].length;
    if (typeof value === "object")
        return Object.keys(value).length;
    throw new Error(`Expected '${String(value)}' to be a collection of some sort.`);
}
export function isEmpty(value) {
    return count(value) === 0;
}
export function notEmpty(value) {
    return isEmpty(value) ? undefined : value;
}
export function cljStr(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "bigint")
        return String(value);
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return `[${value.map(prStr).join(" ")}]`;
    if (value instanceof Set)
        return `#{${[...value].map(prStr).join(" ")}}`;
    if (value instanceof Map)
        return `{${[...value.entries()].map(([k, v]) => `${prStrKey(k)} ${prStr(v)}`).join(", ")}}`;
    if (typeof value === "object") {
        const entries = Object.entries(value);
        return `{${entries.map(([k, v]) => `${prStrKey(k)} ${prStr(v)}`).join(", ")}}`;
    }
    return String(value);
}
export function prStr(value) {
    if (typeof value === "string") {
        if (value.startsWith(":"))
            return value;
        return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return cljStr(value);
}
function prStrKey(key) {
    if (typeof key === "string")
        return key.startsWith(":") ? key : `:${key}`;
    return prStr(key);
}
export function projectRootFromImportMeta(metaUrl) {
    return dirname(dirname(fileURLToPath(metaUrl)));
}
export function toFileUrl(path) {
    return pathToFileURL(path);
}
//# sourceMappingURL=util.js.map