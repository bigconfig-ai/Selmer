import { filters, getFilter } from "./filters.js";
import { SAFE_CONTEXT_KEY, unwrapSafe } from "./safe.js";
import { cljStr, getAccessor, getIn, isEscapingVariables, parseAccessor, shouldFilterMissingValues } from "./util.js";
export { SAFE_CONTEXT_KEY, SAFE_FILTER, isSafeValue, safe, unwrapSafe } from "./safe.js";
export function escapeHtmlStar(s) {
    if (!isEscapingVariables())
        return s;
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
export const escapeHtml$ = escapeHtmlStar;
export function stripDoublequotes(s) {
    return s.length > 1 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}
export function escapeHtml(x) {
    const unwrapped = unwrapSafe(x);
    if (unwrapped !== x)
        return unwrapped;
    return escapeHtmlStar(cljStr(x));
}
export function fixFilterArgs(args) {
    return args.map(stripDoublequotes);
}
export function lookupArgs(context) {
    return (arg) => {
        if (arg.length > 1 && arg.startsWith("@")) {
            const value = getIn(context, parseAccessor(arg.slice(1)));
            return value === undefined || value === null ? arg : value;
        }
        return arg;
    };
}
function splitRespectingQuotes(s, delimiter) {
    const result = [];
    let buf = "";
    let quoted = false;
    let escaped = false;
    for (const ch of s) {
        if (escaped) {
            buf += ch;
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            buf += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            quoted = !quoted;
            buf += ch;
            continue;
        }
        if (!quoted && ch === delimiter) {
            result.push(buf);
            buf = "";
        }
        else {
            buf += ch;
        }
    }
    result.push(buf);
    return result;
}
export function filterStrToFn(s) {
    const [filterName = "", ...rawArgs] = splitRespectingQuotes(s, ":");
    const args = fixFilterArgs(rawArgs);
    const filter = getFilter(filterName.trim());
    if (filter) {
        return (x, context) => filter(x, ...args.map(lookupArgs(context)));
    }
    throw new Error(`No filter defined with the name '${filterName.trim()}'`);
}
export function literal(value) {
    return (value.startsWith('"') && value.endsWith('"')) || /^[0-9]+$/.test(value);
}
export const literal$ = literal;
export function parseLiteral(value) {
    return value.startsWith('"') ? value.slice(1, -1) : value;
}
export function splitValue(s) {
    return splitRespectingQuotes(s, "|").map((part) => part.trim()).filter((part) => part.length > 0);
}
function applyFilters(value, body, filterStrings, compiledFilters, context) {
    return compiledFilters.reduce((acc, filter, index) => {
        const filterString = filterStrings[index];
        try {
            return filter(acc, context);
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`On filter body '${body}' and filter '${filterString}' this error occurred:${message}`, {
                cause
            });
        }
    }, value);
}
export function compileFilterBody(s, escape = true) {
    const [val = "", ...filterStrings] = splitValue(s);
    const accessor = parseAccessor(val);
    const compiledFilters = filterStrings.map(filterStrToFn);
    if (literal(val)) {
        return (context) => {
            const x = applyFilters(parseLiteral(val), s, filterStrings, compiledFilters, context);
            return finalizeFilterValue(x, context, escape);
        };
    }
    return (context) => {
        const valFromContext = accessor.reduce((acc, key) => getAccessor(acc, key), context);
        if (valFromContext !== undefined && valFromContext !== null || (shouldFilterMissingValues() && compiledFilters.length > 0)) {
            const x = applyFilters(valFromContext, s, filterStrings, compiledFilters, context);
            return finalizeFilterValue(x, context, escape);
        }
        return undefined;
    };
}
function finalizeFilterValue(x, context, escape) {
    const unwrapped = unwrapSafe(x);
    if (unwrapped !== x)
        return unwrapped;
    if (getAccessor(context, SAFE_CONTEXT_KEY))
        return unwrapped;
    if (escape)
        return escapeHtml(unwrapped);
    return unwrapped;
}
export { filters };
//# sourceMappingURL=filter-parser.js.map