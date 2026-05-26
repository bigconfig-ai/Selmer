import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filters } from "./filters.js";
import { closingTags, exprTags } from "./tags.js";
import { makeDelimiters, readResource } from "./util.js";
import { Scanner } from "./scanner.js";
import { splitValue } from "./filter-parser.js";
let validationEnabled = true;
export function validateOn() {
    validationEnabled = true;
}
export const validateOn$ = validateOn;
export function validateOff() {
    validationEnabled = false;
}
export const validateOff$ = validateOff;
export class SelmerValidationError extends Error {
    data;
    constructor(message, data) {
        super(message);
        this.name = "SelmerValidationError";
        this.data = data;
    }
}
export const errorTemplate = loadErrorTemplate();
function loadErrorTemplate() {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        resolve("resources/selmer-error-template.html"),
        resolve(here, "../resources/selmer-error-template.html"),
        resolve(here, "../../resources/selmer-error-template.html")
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate))
            return readFileSync(candidate, "utf8");
    }
    return `<html><body><h1>Selmer template error</h1><p>{{error}}</p></body></html>`;
}
export function formatTag(tag) {
    if (!tag)
        return "";
    if (tag.tagType === "expr")
        return `{% ${tag.tagName} ${tag.args?.join(" ") ?? ""} %}`;
    return `{{${tag.tagValue}}}`;
}
export function validationError(error, tag, line, template) {
    const longError = `${error}${tag ? ` ${formatTag(tag)}` : ""}${line ? ` on line ${line}` : ""}${template ? ` for template ${String(template)}` : ""}`;
    throw new SelmerValidationError(longError, {
        type: "selmer/validation-error",
        error,
        errorTemplate,
        "error-template": errorTemplate,
        line,
        template,
        validationErrors: [{ tag: formatTag(tag), line }],
        "validation-errors": [{ tag: formatTag(tag), line }]
    });
}
function validateFilters(template, line, tag) {
    const body = tag.tagType === "filter" ? tag.tagValue : "";
    for (const part of splitValue(body).slice(1)) {
        const filterName = part.split(":")[0].trim();
        if (filterName && !filters.has(filterName))
            validationError(`Unrecognized filter ${body} found inside the tag`, tag, line, template);
    }
}
function closeTags() {
    return [...closingTags.values()].flat();
}
function validateTag(template, line, stack, tag) {
    if (tag.tagType === "filter") {
        validateFilters(template, line, tag);
        return stack;
    }
    for (const arg of tag.args)
        validateFilters(template, line, { tagType: "filter", tagValue: arg });
    const lastTag = stack[stack.length - 1];
    const endTags = lastTag?.tagType === "expr" ? closingTags.get(lastTag.tagName) ?? [] : [];
    if (!tag.tagName)
        validationError("No tag name supplied for the tag", tag, line, template);
    if (!closeTags().includes(tag.tagName) && !exprTags.has(tag.tagName))
        validationError("Unrecognized tag found", tag, line, template);
    if (closeTags().includes(tag.tagName)) {
        const withoutLast = stack.slice(0, -1);
        if (endTags.includes(tag.tagName)) {
            return (closingTags.get(tag.tagName)?.length ?? 0) > 0 ? [...withoutLast, { ...tag, line }] : withoutLast;
        }
        validationError("No closing tag found for the tag", lastTag, lastTag?.line, template);
    }
    if ((closingTags.get(tag.tagName)?.length ?? 0) > 0)
        return [...stack, { ...tag, line }];
    return stack;
}
function skipVerbatim(scanner, tag) {
    if (tag.tagType !== "expr" || tag.tagName !== "verbatim")
        return;
    while (!scanner.eof()) {
        if (scanner.startsWith(scanner.delimiters.tagOpen + scanner.delimiters.tagSecond)) {
            const next = scanner.readTagInfo();
            if (next.tagType === "expr" && next.tagName === "endverbatim")
                return;
        }
        else
            scanner.readChar();
    }
}
export function validateTags(content, template, opts = {}) {
    const scanner = new Scanner(content, makeDelimiters(opts));
    let line = 1;
    let stack = [];
    while (!scanner.eof()) {
        if (scanner.startsWith(scanner.delimiters.tagOpen + scanner.delimiters.filterOpen) || scanner.startsWith(scanner.delimiters.tagOpen + scanner.delimiters.tagSecond)) {
            try {
                const tag = scanner.readTagInfo();
                if (tag.tagType === "expr" && tag.tagName === "verbatim") {
                    skipVerbatim(scanner, tag);
                }
                else {
                    stack = validateTag(template, line, stack, tag);
                }
            }
            catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause);
                validationError(`Error parsing the tag: ${message}`, undefined, line, template);
            }
        }
        else {
            const ch = scanner.readChar();
            if (ch === "\n")
                line += 1;
        }
    }
    return stack;
}
export function validate(template, opts = {}) {
    if (!validationEnabled)
        return;
    const content = readResource(template, opts).content;
    const orphanTags = validateTags(content, template, opts);
    if (orphanTags.length > 0) {
        validationError(`The template contains orphan tags: ${orphanTags.map((tag) => `${formatTag(tag)} on line ${tag.line}`).join(", ")}`, orphanTags[0], orphanTags[0].line, template);
    }
}
//# sourceMappingURL=validator.js.map