import { format as nodeFormat } from "node:util";
import { safe } from "./safe.js";
import { cljStr, count, getAccessor, hex, isEmpty, isNil, seq } from "./util.js";
export const filters = new Map();
export function parseNumber(value) {
    if (typeof value === "number")
        return value;
    const n = Number(String(value));
    if (Number.isNaN(n))
        throw new Error(`Expected '${String(value)}' to be a number.`);
    return n;
}
function throwWhenExpectingSeqable(x, msg) {
    if (isNil(x))
        return;
    try {
        seq(x);
    }
    catch {
        throw new Error(msg ?? `Expected '${String(x)}' to be a collection of some sort.`);
    }
}
function throwWhenExpectingNumber(x, msg) {
    if (typeof x !== "number")
        throw new Error(msg ?? `Expected '${isNil(x) ? "nil" : String(x)}' to be a number.`);
}
function asArray(value) {
    return seq(value);
}
function isNumericString(value) {
    return /^-?[0-9]*\.?[0-9]+$/.test(String(value));
}
function formatNumberLikeClojure(value) {
    if (Number.isInteger(value))
        return value;
    return Number(value.toFixed(12)).toString();
}
function range(end, start, step) {
    const actualStart = start ?? 0;
    const actualStep = step ?? 1;
    const result = [];
    if (actualStep === 0)
        throw new Error("step must not be 0");
    if (actualStep > 0) {
        for (let i = actualStart; i < end; i += actualStep)
            result.push(i);
    }
    else {
        for (let i = actualStart; i > end; i += actualStep)
            result.push(i);
    }
    return result;
}
function title(s) {
    return s.split(" ").map(capitalize).join(" ");
}
function capitalize(s) {
    if (s.length === 0)
        return s;
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
}
function localeFromArgs(locale, country) {
    if (!locale)
        return undefined;
    return country ? `${locale}-${country}` : String(locale).replace("_", "-");
}
function numberFormat(n, fmt, locale) {
    const match = /^%\.(\d+)f$/.exec(fmt);
    if (match) {
        const fixed = n.toFixed(Number(match[1]));
        return locale?.startsWith("de") ? fixed.replace(".", ",") : fixed;
    }
    return nodeFormat(fmt, n);
}
function pad(n, width = 2) {
    return String(n).padStart(width, "0");
}
function formatDate(dateLike, fmt, locale) {
    if (isNil(dateLike))
        return undefined;
    let wrapQuotes = false;
    if (fmt.startsWith('"') && fmt.endsWith('"')) {
        fmt = fmt.slice(1, -1);
        wrapQuotes = true;
    }
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (Number.isNaN(date.getTime()))
        throw new Error(`${String(dateLike)} is not a valid date format.`);
    const loc = localeFromArgs(locale) ?? undefined;
    const aliases = {
        shortTime: () => `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        shortDate: () => {
            if (loc?.startsWith("zh"))
                return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        },
        shortDateTime: () => `${aliases.shortDate()} ${aliases.shortTime()}`,
        mediumDate: () => aliases.shortDate(),
        mediumTime: () => `${aliases.shortTime()}:${pad(date.getSeconds())}`,
        mediumDateTime: () => `${aliases.shortDate()} ${aliases.mediumTime()}`,
        longDate: () => {
            if (loc?.startsWith("zh"))
                return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
            const month = new Intl.DateTimeFormat(loc ?? "en-US", { month: "short" }).format(date);
            return `${date.getFullYear()} ${month} ${date.getDate()}`;
        },
        longTime: () => aliases.mediumTime(),
        longDateTime: () => `${aliases.longDate()} ${aliases.mediumTime()}`,
        fullDate: () => new Intl.DateTimeFormat(loc, { dateStyle: "full" }).format(date),
        fullTime: () => new Intl.DateTimeFormat(loc, { timeStyle: "full" }).format(date),
        fullDateTime: () => new Intl.DateTimeFormat(loc, { dateStyle: "full", timeStyle: "full" }).format(date)
    };
    const formatted = aliases[fmt]?.() ?? formatJavaDatePattern(date, fmt, loc);
    return wrapQuotes ? `"${formatted}"` : formatted;
}
function formatJavaDatePattern(date, fmt, locale) {
    const monthLong = new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
    const monthShort = new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
    return fmt
        .replace(/yyyy/g, String(date.getFullYear()))
        .replace(/MMMM/g, monthLong)
        .replace(/MMM/g, monthShort)
        .replace(/MM/g, pad(date.getMonth() + 1))
        .replace(/dd/g, pad(date.getDate()))
        .replace(/HH/g, pad(date.getHours()))
        .replace(/mm/g, pad(date.getMinutes()))
        .replace(/ss/g, pad(date.getSeconds()));
}
function getFilterValue(value, key, defaultValue) {
    const found = getAccessor(value, typeof key === "string" && key.startsWith(":") ? key.slice(1) : key);
    return found === undefined || found === null ? defaultValue : found;
}
const builtIns = {
    str: (x) => cljStr(x),
    subs: (s, start, end, ...rest) => {
        const result = String(s).slice(parseNumber(start), parseNumber(end));
        return rest.length > 0 && String(s).length !== result.length ? result + rest.map(String).join("") : result;
    },
    "abbr-left": (s) => ({ ...(typeof s === "object" && s !== null ? s : { s }), abbrPosition: "left" }),
    "abbr-middle": (s) => ({ ...(typeof s === "object" && s !== null ? s : { s }), abbrPosition: "middle" }),
    "abbr-right": (s) => ({ ...(typeof s === "object" && s !== null ? s : { s }), abbrPosition: "right" }),
    "abbr-ellipsis": (s, ellipsis) => ({
        ...(typeof s === "object" && s !== null ? s : { s }),
        abbrEllipsis: String(ellipsis)
    }),
    abbreviate: (input, maxWidthArg, abbreviatedWidthArg) => {
        const obj = typeof input === "object" && input !== null && "s" in input ? input : { s: input };
        const maxWidth = parseNumber(maxWidthArg);
        const abbreviatedWidth = abbreviatedWidthArg == null ? maxWidth : parseNumber(abbreviatedWidthArg);
        const ellipsis = String(obj.abbrEllipsis ?? "...");
        const position = String(obj.abbrPosition ?? "right");
        const effectiveWidth = abbreviatedWidth - ellipsis.length;
        const s = String(obj.s);
        if (maxWidth < abbreviatedWidth)
            throw new Error(`Maximum width ${maxWidth} can't be shorter than abbreviated width ${abbreviatedWidth}`);
        if (abbreviatedWidth < ellipsis.length)
            throw new Error(`Length ${ellipsis.length} of ellipsis '${ellipsis}' can't be bigger than abbreviated width ${abbreviatedWidth}`);
        if (s.length <= maxWidth)
            return s;
        switch (position) {
            case "left":
                return ellipsis + s.slice(s.length - effectiveWidth);
            case "middle": {
                const half = Math.floor(effectiveWidth / 2);
                return s.slice(0, half) + ellipsis + s.slice(s.length - half);
            }
            default:
                return s.slice(0, effectiveWidth) + ellipsis;
        }
    },
    add: (x, y, ...rest) => {
        const args = [String(x), y, ...rest];
        if (args.every(isNumericString))
            return formatNumberLikeClojure(args.reduce((sum, v) => sum + parseNumber(v), 0));
        return args.map(String).join("");
    },
    multiply: (x, y) => formatNumberLikeClojure(parseNumber(x) * parseNumber(y)),
    divide: (x, y) => {
        const divisor = parseNumber(y);
        if (divisor === 0)
            throw new Error("Divide by zero");
        return formatNumberLikeClojure(parseNumber(x) / divisor);
    },
    round: (x) => Math.round(parseNumber(x)),
    addslashes: (s) => String(s).replace(/["']/g, (m) => `\\${m}`),
    center: (s, w) => {
        const value = String(s);
        const width = parseNumber(String(w).trim());
        const left = Math.ceil((width - value.length) / 2);
        const right = Math.floor((width - value.length) / 2);
        return `${" ".repeat(Math.max(0, left))}${value}${" ".repeat(Math.max(0, right))}`;
    },
    "currency-format": (n, locale, country) => {
        throwWhenExpectingNumber(n);
        const loc = localeFromArgs(locale, country);
        const currency = loc?.toLowerCase().startsWith("de") ? "EUR" : "USD";
        return new Intl.NumberFormat(loc, { style: "currency", currency }).format(n);
    },
    "number-format": (n, fmt, locale) => {
        throwWhenExpectingNumber(n);
        return numberFormat(n, String(fmt), locale ? String(locale) : undefined);
    },
    date: (d, fmt, locale) => formatDate(d, String(fmt), locale),
    default: (x, defaultValue) => (x === null || x === undefined || x === false ? defaultValue : x),
    "default-if-empty": (coll, defaultValue) => {
        try {
            return coll == null || isEmpty(coll) ? defaultValue : coll;
        }
        catch {
            throwWhenExpectingSeqable(coll);
            return coll;
        }
    },
    "double-format": (n, decimalPlaces) => {
        throwWhenExpectingNumber(n);
        return n.toFixed(decimalPlaces == null ? 1 : parseNumber(decimalPlaces));
    },
    first: (coll) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll)[0];
    },
    take: (coll, n) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll).slice(0, parseNumber(n));
    },
    drop: (coll, n) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll).slice(parseNumber(n));
    },
    "drop-last": (coll, n) => {
        throwWhenExpectingSeqable(coll);
        const arr = asArray(coll);
        return arr.slice(0, Math.max(0, arr.length - parseNumber(n)));
    },
    "get-digit": (n, i) => {
        const chars = [...String(n)];
        const idx = chars.length - parseNumber(i);
        if (idx < 0 || idx >= chars.length)
            return n;
        return chars[idx] === "." ? chars[idx - 1] : chars[idx];
    },
    hash: (s, algorithm) => hex(String(algorithm), String(s)),
    join: (coll, sep) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll).map(cljStr).join(sep == null ? "" : String(sep));
    },
    "empty?": (x) => isEmpty(x),
    "not-empty": (x) => (isEmpty(x) ? undefined : x),
    json: (x) => JSON.stringify(x ?? null),
    last: (coll) => {
        throwWhenExpectingSeqable(coll);
        const arr = asArray(coll);
        return arr[arr.length - 1];
    },
    length: (coll) => count(coll),
    count: (coll) => count(coll),
    "length-is": (coll, n) => safe(parseNumber(n) === count(coll)),
    "count-is": (coll, n) => safe(parseNumber(n) === count(coll)),
    linebreaks: (s) => {
        const br = String(s).replace(/\n/g, "<br />");
        const p = br.replace(/<br \/><br \/>/g, "</p><p>").replace(/<p>$/, "");
        return p.endsWith("</p>") ? `<p>${p}` : `<p>${p}</p>`;
    },
    "linebreaks-br": (s) => String(s).replace(/\n/g, "<br />"),
    linenumbers: (s) => String(s).split("\n").map((line, i) => `${i + 1}. ${line}`).join("\n"),
    "rand-nth": (coll) => {
        throwWhenExpectingSeqable(coll);
        const arr = asArray(coll);
        return arr[Math.floor(Math.random() * arr.length)];
    },
    range: (end, start, step) => range(parseNumber(end), start == null ? undefined : parseNumber(start), step == null ? undefined : parseNumber(step)),
    remove: (s, toRemove) => {
        const removeSet = new Set([...String(toRemove)]);
        return [...String(s)].filter((ch) => !removeSet.has(ch)).join("");
    },
    pluralize: (nOrColl, ...opts) => {
        const n = typeof nOrColl === "number" ? nOrColl : count(nOrColl);
        const plural = opts.length === 0 ? "s" : opts.length === 1 ? opts[0] : opts[1];
        const singular = opts.length === 2 ? opts[0] : "";
        return n === 1 ? singular : plural;
    },
    safe: (s) => safe(s),
    urlescape: (s) => encodeURIComponent(String(s)).replace(/%20/g, "+"),
    lower: (s) => String(s).toLowerCase(),
    upper: (s) => String(s).toUpperCase(),
    capitalize: (s) => capitalize(String(s)),
    title: (s) => title(String(s)),
    sort: (coll) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll).slice().sort(compareValues);
    },
    "sort-by": (coll, k) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll).slice().sort((a, b) => compareValues(getFilterValue(a, k), getFilterValue(b, k)));
    },
    "sort-by-reversed": (coll, k) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll).slice().sort((a, b) => compareValues(getFilterValue(b, k), getFilterValue(a, k)));
    },
    "sort-reversed": (coll) => {
        throwWhenExpectingSeqable(coll);
        return asArray(coll).slice().sort((a, b) => compareValues(b, a));
    },
    "between?": (val, x, y) => {
        const v = parseNumber(val);
        const a = parseNumber(x);
        const b = parseNumber(y);
        return safe(a <= b ? a <= v && v <= b : b <= v && v <= a);
    },
    replace: (s, search, replacement) => String(s).split(String(search)).join(String(replacement)),
    "remove-tags": (s, ...tags) => {
        if (tags.length === 0)
            return s;
        const group = `(${tags.map((t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
        return String(s)
            .replace(new RegExp(`<${group}(/?>|(\\s+[^>]*>))`, "gi"), "")
            .replace(new RegExp(`</${group}>`, "gi"), "");
    },
    email: (email, validate) => {
        const address = String(email);
        if (validate === "false" || /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/.test(address)) {
            return safe(`<a href='mailto:${address}'>${address}</a>`);
        }
        throw new Error(`${address} does not appear to be a valid email address`);
    },
    phone: (phone, arg1, arg2) => {
        let nationalPrefix;
        let validate = true;
        if (arg1 != null && arg2 != null) {
            nationalPrefix = arg1;
            validate = arg2 === "false" ? false : arg2 === "true" ? true : Boolean(arg2);
        }
        else if (arg1 == null) {
            validate = true;
        }
        else if (arg1 === "false") {
            validate = false;
        }
        else if (arg1 === "true") {
            validate = true;
        }
        else {
            nationalPrefix = arg1;
        }
        const original = String(phone);
        const number = nationalPrefix ? original.replace(/^0/, `+${String(nationalPrefix)}-`) : original;
        if (!validate || /^[0-9 +-]*$/.test(number)) {
            return safe(`<a href='tel:${number.replace(/\s+/g, "-")}'>${original}</a>`);
        }
        throw new Error(`${number} does not appear to be a valid phone number`);
    },
    name: (x) => {
        const s = String(x).replace(/^:/, "");
        return s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
    },
    get: (x, key, defaultValue) => getFilterValue(x, key, defaultValue)
};
function compareValues(a, b) {
    if (a === b)
        return 0;
    if (a == null)
        return -1;
    if (b == null)
        return 1;
    return a < b ? -1 : 1;
}
for (const [name, fn] of Object.entries(builtIns))
    filters.set(name, fn);
export function getFilter(name) {
    return filters.get(name.startsWith(":") ? name.slice(1) : name);
}
export function callFilter(name, ...args) {
    const filter = getFilter(name);
    if (!filter)
        throw new Error(`No filter defined with the name '${name}'`);
    return filter(args[0], ...args.slice(1));
}
export function addFilter(name, fn) {
    filters.set(name.startsWith(":") ? name.slice(1) : name, fn);
}
export const addFilter$ = addFilter;
export function removeFilter(name) {
    filters.delete(name.startsWith(":") ? name.slice(1) : name);
}
export const removeFilter$ = removeFilter;
//# sourceMappingURL=filters.js.map