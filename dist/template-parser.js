import { escapeRegExp, expressionClose, expressionOpen, makeDelimiters, readResource, variableClose, variableOpen } from "./util.js";
import { Scanner, readTagInfoFromString, tagInnerContent } from "./scanner.js";
import { validate } from "./validator.js";
class Buffer {
    value = "";
    append(s) {
        if (s != null)
            this.value += s;
    }
    toString() {
        return this.value;
    }
}
function tagInfo(tagStr, delimiters) {
    return readTagInfoFromString(tagStr, delimiters);
}
export function getTagParams(tagId, blockStr, opts = {}) {
    const d = makeDelimiters(opts);
    const info = tagInfo(blockStr, d);
    if (info.tagType !== "expr" || info.tagName !== tagId)
        return "";
    return info.args.join(" ").trim();
}
export function parseDefaults(defaultParts) {
    if (!defaultParts || defaultParts.length === 0)
        return undefined;
    const joined = defaultParts.join(" ");
    const defaults = {};
    const re = /([^=\s]+)\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = re.exec(joined)))
        defaults[match[1]] = match[2];
    return defaults;
}
export function splitIncludeTag(tagStr, opts = {}) {
    const params = getTagParams("include", tagStr.replace(/\\/g, "/"), opts);
    return params.match(/"[^"]*"|[^\s]+/g) ?? [];
}
export function getParent(tagStr, opts = {}) {
    const template = getTagParams("extends", tagStr, opts);
    return template.startsWith('"') && template.endsWith('"') ? template.slice(1, -1) : template;
}
function classifyTag(tagStr, delimiters) {
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
function writeTag(superTag, existingBlock, blocksToClose, omitCloseTag) {
    return superTag || (!existingBlock && blocksToClose > (omitCloseTag ? 1 : 0));
}
function processIncludes(tagStr, blocks, opts) {
    const params = splitIncludeTag(tagStr, opts);
    const source = (params[0] ?? "").replace(/"/g, "");
    const defaults = parseDefaults(params.slice(2));
    return preprocessTemplateFile(source, opts, blocks, defaults);
}
export function consumeBlock(scanner, opts, buf, blocks = {}, omitCloseTag = false) {
    let blocksToClose = 1;
    let hasSuper = false;
    const d = scanner.delimiters;
    while (blocksToClose > 0 && !scanner.eof()) {
        if (startsTag(scanner)) {
            const tagStr = scanner.readTagContent();
            const tag = classifyTag(tagStr, d);
            const existingBlock = tag.blockName ? blocks[tag.blockName] : undefined;
            if (buf) {
                if (tag.include)
                    buf.append(processIncludes(tagStr, blocks, opts));
                else if (writeTag(tag.superTag, existingBlock, blocksToClose, omitCloseTag))
                    buf.append(tagStr);
            }
            if (existingBlock && tag.blockName) {
                consumeBlock(scanner, opts);
                const nestedBlocks = { ...blocks };
                delete nestedBlocks[tag.blockName];
                consumeBlock(new Scanner(existingBlock.content, d), opts, buf, nestedBlocks);
            }
            else if (tag.block) {
                blocksToClose += 1;
            }
            else if (tag.endblock) {
                blocksToClose -= 1;
            }
            hasSuper = hasSuper || tag.superTag;
        }
        else {
            const ch = scanner.readChar();
            buf?.append(ch);
        }
    }
    return hasSuper;
}
export function rewriteSuper(block, parentContent, opts = {}) {
    const d = makeDelimiters(opts);
    const superTag = `${escapeRegExp(variableOpen(d))}\\s*block\\.super\\s*${escapeRegExp(variableClose(d))}`;
    return block.replace(new RegExp(superTag, "g"), parentContent);
}
export function readBlock(scanner, blockTag, blocks, opts) {
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
export function processBlock(scanner, buf, blockTag, blocks, opts) {
    const d = scanner.delimiters;
    const blockName = classifyTag(blockTag, d).blockName ?? "";
    const childContent = blocks[blockName]?.content;
    if (childContent != null) {
        const parent = new Buffer();
        consumeBlock(scanner, opts, parent, blocks, true);
        buf.append(rewriteSuper(childContent, parent.toString(), opts));
    }
    else {
        buf.append(blockTag);
        consumeBlock(scanner, opts, buf, blocks);
    }
}
export function wrapInExpressionTag(s, opts = {}) {
    const d = makeDelimiters(opts);
    return `${expressionOpen(d)}${s}${expressionClose(d)}`;
}
export function wrapInVariableTag(s, opts = {}) {
    const d = makeDelimiters(opts);
    return `${variableOpen(d)}${s}${variableClose(d)}`;
}
export function trimVariableTag(s, opts = {}) {
    return tagInnerContent(s, makeDelimiters(opts));
}
export function trimExpressionTag(s, opts = {}) {
    return tagInnerContent(s, makeDelimiters(opts));
}
function unparseDefaults(defaults) {
    if (!defaults)
        return undefined;
    return Object.entries(defaults).map(([k, v]) => `${k}="${v}"`).join(" ").trim();
}
export function toExpressionString(tagName, args, defaults, opts = {}) {
    const defaultsString = tagName === "include" ? unparseDefaults(defaults) : undefined;
    const joined = `${tagName}${args.length > 0 ? ` ${args.join(" ")}` : ""}${defaultsString ? ` with ${defaultsString}` : ""}`;
    return wrapInExpressionTag(joined, opts);
}
export function addDefault(identifier, defaultValue) {
    return `${identifier}|default:"${defaultValue}"`;
}
export function tryAddDefault(identifier, defaults) {
    return defaults?.[identifier] != null ? addDefault(identifier, defaults[identifier]) : identifier;
}
export function addDefaultsToVariableTag(tagStr, defaults, opts = {}) {
    return wrapInVariableTag(tryAddDefault(trimVariableTag(tagStr, opts), defaults), opts);
}
export function addDefaultsToExpressionTag(tagStr, defaults, opts = {}) {
    const d = makeDelimiters(opts);
    const info = tagInfo(tagStr, d);
    if (info.tagType !== "expr")
        return tagStr;
    const args = info.args.map((arg) => tryAddDefault(arg, defaults));
    return toExpressionString(info.tagName, args, defaults, opts);
}
export function preprocessTemplateString(template, opts = {}, blocks, defaults) {
    return readTemplate(template, opts, blocks, defaults, true);
}
export function preprocessTemplateFile(template, opts = {}, blocks, defaults) {
    return readTemplate(template, opts, blocks, defaults, false);
}
export function preprocessTemplate(template, opts = {}) {
    return typeof template === "string" && template.includes("\n") ? preprocessTemplateString(template, opts) : preprocessTemplateFile(template, opts);
}
function readTemplate(template, opts, blocks = {}, defaults, stringMode = false) {
    const d = makeDelimiters(opts);
    const source = stringMode ? String(template) : readTemplateFile(template, opts);
    const scanner = new Scanner(source, d);
    const buf = new Buffer();
    let parent;
    let currentBlocks = blocks;
    while (!scanner.eof()) {
        if (startsTag(scanner)) {
            const tagStr = scanner.readTagContent();
            const tag = classifyTag(tagStr, d);
            if (defaults && tag.info.tagType === "filter") {
                buf.append(addDefaultsToVariableTag(tagStr, defaults, opts));
            }
            else if (defaults && tag.info.tagType === "expr" && !tag.include) {
                buf.append(addDefaultsToExpressionTag(tagStr, defaults, opts));
            }
            else if (defaults && tag.include) {
                buf.append(processIncludes(addDefaultsToExpressionTag(tagStr, defaults, opts), currentBlocks, opts));
            }
            else if (tag.include) {
                buf.append(processIncludes(tagStr, currentBlocks, opts));
            }
            else if (tag.extends) {
                parent = getParent(tagStr, opts);
            }
            else if (parent && tag.block) {
                currentBlocks = readBlock(scanner, tagStr, currentBlocks, opts);
            }
            else if (tag.block) {
                processBlock(scanner, buf, tagStr, currentBlocks, opts);
            }
            else if (!parent) {
                buf.append(tagStr);
            }
        }
        else {
            const ch = scanner.readChar();
            if (!parent)
                buf.append(ch);
        }
    }
    return parent ? readTemplate(parent, opts, currentBlocks, defaults, false) : buf.toString();
}
function readTemplateFile(template, opts) {
    validate(template, opts);
    return readResource(template, opts).content;
}
function startsTag(scanner) {
    const d = scanner.delimiters;
    return scanner.startsWith(d.tagOpen + d.filterOpen) || scanner.startsWith(d.tagOpen + d.tagSecond);
}
//# sourceMappingURL=template-parser.js.map