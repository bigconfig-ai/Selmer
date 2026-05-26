import { statSync } from "node:fs";
import { FunctionNode, TextNode } from "./node.js";
import { compileFilterBody, literal, parseLiteral } from "./filter-parser.js";
import { addFilter } from "./filters.js";
import { exprTags } from "./tags.js";
import { cljStr, getMissingValueFormatter, makeDelimiters, parseAccessor, readResource, resourcePath, setResourcePath as setResourcePathUtil } from "./util.js";
import { Scanner } from "./scanner.js";
import { preprocessTemplateFile, preprocessTemplateString } from "./template-parser.js";
const templates = new Map();
let cacheEnabled = true;
export { templates };
export function clearCache() {
    templates.clear();
}
export const clearCache$ = clearCache;
export function cacheOn() {
    cacheEnabled = true;
}
export const cacheOn$ = cacheOn;
export function cacheOff() {
    clearCache();
    cacheEnabled = false;
}
export const cacheOff$ = cacheOff;
export function setResourcePath(path) {
    setResourcePathUtil(path);
}
export const setResourcePath$ = setResourcePath;
export function addFilter$ForParser(name, fn) {
    addFilter(name, fn);
}
export { addFilter as addFilter };
function applyCustoms(opts = {}) {
    if (opts.customTags) {
        for (const [name, handler] of Object.entries(opts.customTags))
            exprTags.set(name.startsWith(":") ? name.slice(1) : name, handler);
    }
    if (opts.customFilters) {
        for (const [name, handler] of Object.entries(opts.customFilters))
            addFilter(name, handler);
    }
}
export function renderTemplate(template, context) {
    let output = "";
    for (const element of template) {
        const value = element.renderNode(context);
        if (value === undefined || value === null) {
            const tag = element instanceof FunctionNode ? element.meta?.tag : undefined;
            output += cljStr(getMissingValueFormatter()(tag ?? { tagValue: undefined }, context));
        }
        else {
            output += cljStr(value);
        }
    }
    return output;
}
export const renderTemplate$ = renderTemplate;
export function render(s, context = {}, opts = {}) {
    return renderTemplate(parseString(s, opts), context);
}
export function renderFile(filenameOrUrl, context = {}, opts = {}) {
    const useCache = opts.cache ?? cacheEnabled;
    const resource = resourcePath(filenameOrUrl, opts);
    if (!resource) {
        throw new Error(`resource-path for ${String(filenameOrUrl)} returned nil, typically means the file doesn't exist in your classpath.`);
    }
    const lastModified = resource.lastModified >= 0 ? resource.lastModified : statSafe(resource.path);
    const cached = templates.get(resource.path);
    if (useCache && cached && cached.lastModified === lastModified)
        return renderTemplate(cached.template, context);
    const template = parseFile(filenameOrUrl, opts);
    templates.set(resource.path, { template, lastModified });
    return renderTemplate(template, context);
}
function statSafe(path) {
    try {
        return statSync(path).mtimeMs;
    }
    catch {
        return -1;
    }
}
export function parseString(input, opts = {}) {
    return compileSource(preprocessTemplateString(input, opts), opts);
}
export function parseFile(file, opts = {}) {
    return compileSource(preprocessTemplateFile(file, opts), opts);
}
export function parseInput(input, opts = {}) {
    const delimiters = makeDelimiters(opts);
    const source = shouldTreatInputAsPath(input, opts, delimiters) ? readResource(input, opts).content : input;
    return compileSource(source, opts, delimiters);
}
function compileSource(source, opts, delimiters = makeDelimiters(opts)) {
    applyCustoms(opts);
    const tags = [];
    const scanner = new Scanner(source, delimiters, tags);
    const parsed = parseScanner(scanner, opts, tags);
    parsed.allTags = tags;
    return parsed;
}
export function parse(parseFn, input, opts = {}) {
    return parseFn(input, opts);
}
function shouldTreatInputAsPath(input, opts, delimiters) {
    if (input.includes("\n"))
        return false;
    if (input.includes(delimiters.tagOpen + delimiters.filterOpen) || input.includes(delimiters.tagOpen + delimiters.tagSecond))
        return false;
    return Boolean(resourcePath(input, opts));
}
function parseScanner(scanner, opts, tags) {
    const template = [];
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
        }
        else {
            buf += scanner.readChar() ?? "";
        }
    }
    template.push(new TextNode(buf));
    return template;
}
function startsTag(scanner) {
    const d = scanner.delimiters;
    return scanner.startsWith(d.tagOpen + d.filterOpen) || scanner.startsWith(d.tagOpen + d.tagSecond);
}
function startsShortComment(scanner) {
    const d = scanner.delimiters;
    return scanner.startsWith(d.tagOpen + d.shortCommentSecond);
}
export function exprTag(tag, scanner, opts, tags) {
    const handler = exprTags.get(tag.tagName);
    if (!handler)
        throw new Error(`unrecognized tag: ${tag.tagName} - did you forget to close a tag?`);
    return handler(tag.args, (s, start, ...end) => tagContent(s, start, opts, tags, ...end), renderTemplate, scanner);
}
export function filterTag(tag) {
    return compileFilterBody(tag.tagValue);
}
export function parseTag(tag, scanner, opts, tags) {
    const handler = tag.tagType === "filter" ? filterTag(tag) : exprTag(tag, scanner, opts, tags);
    handler.meta = { tag };
    return handler;
}
function appendNode(content, tag, buf, scanner, opts, tags) {
    return [...content, new TextNode(buf), new FunctionNode(parseTag(tag, scanner, opts, tags))];
}
function ensureList(value) {
    if (value === undefined)
        return [];
    return Array.isArray(value) ? value : [value];
}
function updateTags(tag, tagsMap, content, args, buf) {
    const block = { args, content: [...content, new TextNode(buf)] };
    const existing = tagsMap[tag];
    if (existing)
        return { ...tagsMap, [tag]: [...ensureList(existing), block] };
    return { ...tagsMap, [tag]: block };
}
export function tagContent(scanner, startTag, opts, allTags, ...endTags0) {
    let tagsMap = {};
    let content = [];
    let curTag = startTag;
    let endTags = [...endTags0];
    let curArgs;
    let buf = "";
    while (true) {
        if (scanner.eof()) {
            if (endTags.length > 0)
                throw new Error(`No closing tag found for ${startTag}`);
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
                if (tagName !== "elif")
                    endTags = endTags.slice(endIndex + 1);
                if (endTags.length === 0)
                    return tagsMap;
            }
            else {
                content = appendNode(content, tag, buf, scanner, opts, allTags);
                buf = "";
            }
        }
        else {
            buf += scanner.readChar() ?? "";
        }
    }
}
function parseVariablePaths(arg) {
    const value = splitValueLocal(arg)[0];
    return value ? parseAccessor(value) : undefined;
}
function splitValueLocal(s) {
    const result = [];
    let buf = "";
    let quoted = false;
    for (const ch of s) {
        if (ch === '"')
            quoted = !quoted;
        if (!quoted && ch === "|") {
            result.push(buf.trim());
            buf = "";
        }
        else {
            buf += ch;
        }
    }
    result.push(buf.trim());
    return result.filter(Boolean);
}
function pathKey(path) {
    return JSON.stringify(path);
}
function parseVariables(tags) {
    const vars = new Map();
    let nestedKeys = new Set();
    const add = (path) => {
        if (path && path.length > 0)
            vars.set(pathKey(path), path);
    };
    for (const tag of tags) {
        if (tag.tagType === "filter") {
            const v = parseVariablePaths(tag.tagValue);
            if (v && !nestedKeys.has(v[0]))
                add(v);
        }
        else if (tag.tagName === "for") {
            const [ids, inPart] = aggregateArgsLocal(tag.args);
            add(parseVariablePaths(inPart[1] ?? ""));
            nestedKeys = new Set([...ids.map((id) => parseAccessor(id)[0]), "forloop"]);
        }
        else if (tag.tagName === "with") {
            const [id, value] = (tag.args[0] ?? "").split("=");
            add(parseVariablePaths(value));
            nestedKeys = new Set([parseAccessor(id)[0]]);
        }
        else if (tag.tagName === "endfor" || tag.tagName === "endwith") {
            nestedKeys = new Set();
        }
        else {
            const special = new Set([undefined, "not", "all", "any", "<", ">", "=", "<=", ">="]);
            for (const arg of tag.args) {
                if (literal(arg))
                    continue;
                const v = parseVariablePaths(arg);
                if (!v || special.has(v[0]) || nestedKeys.has(v[0]))
                    continue;
                add(v);
            }
        }
    }
    return [...vars.values()];
}
function aggregateArgsLocal(args) {
    const split = args.flatMap((arg) => arg.split(",")).filter((arg) => arg !== "");
    const idx = split.indexOf("in");
    return [split.slice(0, idx), ["in", split[idx + 1]]];
}
export function knownVariablePaths(input, opts = {}) {
    const parsed = parseInput(input, opts);
    return parseVariables(parsed.allTags ?? []);
}
export function knownVariables(input, opts = {}) {
    return new Set(knownVariablePaths(input, opts).map((path) => path[0]));
}
export function resolveArg(arg, context) {
    if (literal(arg))
        return parseLiteral(arg);
    return render(arg, context);
}
export { readResource };
//# sourceMappingURL=parser.js.map