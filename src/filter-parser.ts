import type { Context, FilterFunction } from "./types.js";
import { filters, getFilter } from "./filters.js";
import { SAFE_CONTEXT_KEY, safe, unwrapSafe, type SafeValue } from "./safe.js";
import {
  cljStr,
  getAccessor,
  getIn,
  isEscapingVariables,
  parseAccessor,
  shouldFilterMissingValues
} from "./util.js";

export { SAFE_CONTEXT_KEY, SAFE_FILTER, isSafeValue, safe, unwrapSafe, type SafeValue } from "./safe.js";

export function escapeHtmlStar(s: string): string {
  if (!isEscapingVariables()) return s;
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const escapeHtml$ = escapeHtmlStar;

export function stripDoublequotes(s: string): string {
  return s.length > 1 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

export function escapeHtml(x: unknown): unknown {
  const unwrapped = unwrapSafe(x);
  if (unwrapped !== x) return unwrapped;
  return escapeHtmlStar(cljStr(x));
}

export function fixFilterArgs(args: string[]): string[] {
  return args.map(stripDoublequotes);
}

export function lookupArgs(context: Context): (arg: string) => unknown {
  return (arg: string) => {
    if (arg.length > 1 && arg.startsWith("@")) {
      const value = getIn(context, parseAccessor(arg.slice(1)));
      return value === undefined || value === null ? arg : value;
    }
    return arg;
  };
}

function splitRespectingQuotes(s: string, delimiter: string): string[] {
  const result: string[] = [];
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
    } else {
      buf += ch;
    }
  }
  result.push(buf);
  return result;
}

export function filterStrToFn(s: string): (x: unknown, context: Context) => unknown {
  const [filterName = "", ...rawArgs] = splitRespectingQuotes(s, ":");
  const args = fixFilterArgs(rawArgs);
  const filter = getFilter(filterName.trim());
  if (filter) {
    return (x: unknown, context: Context) => filter(x, ...args.map(lookupArgs(context)));
  }
  throw new Error(`No filter defined with the name '${filterName.trim()}'`);
}

export function literal(value: string): boolean {
  return (value.startsWith('"') && value.endsWith('"')) || /^[0-9]+$/.test(value);
}

export const literal$ = literal;

export function parseLiteral(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1) : value;
}

export function splitValue(s: string): string[] {
  return splitRespectingQuotes(s, "|").map((part) => part.trim()).filter((part) => part.length > 0);
}

function applyFilters(
  value: unknown,
  body: string,
  filterStrings: string[],
  compiledFilters: Array<(x: unknown, context: Context) => unknown>,
  context: Context
): unknown {
  return compiledFilters.reduce((acc, filter, index) => {
    const filterString = filterStrings[index];
    try {
      return filter(acc, context);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`On filter body '${body}' and filter '${filterString}' this error occurred:${message}`, {
        cause
      });
    }
  }, value);
}

export function compileFilterBody(s: string, escape = true): (context: Context) => unknown {
  const [val = "", ...filterStrings] = splitValue(s);
  const accessor = parseAccessor(val);
  const compiledFilters = filterStrings.map(filterStrToFn);

  if (literal(val)) {
    return (context: Context) => {
      const x = applyFilters(parseLiteral(val), s, filterStrings, compiledFilters, context);
      return finalizeFilterValue(x, context, escape);
    };
  }

  return (context: Context) => {
    const valFromContext = accessor.reduce((acc: unknown, key) => getAccessor(acc, key), context as unknown);
    if (valFromContext !== undefined && valFromContext !== null || (shouldFilterMissingValues() && compiledFilters.length > 0)) {
      const x = applyFilters(valFromContext, s, filterStrings, compiledFilters, context);
      return finalizeFilterValue(x, context, escape);
    }
    return undefined;
  };
}

function finalizeFilterValue(x: unknown, context: Context, escape: boolean): unknown {
  const unwrapped = unwrapSafe(x);
  if (unwrapped !== x) return unwrapped;
  if (getAccessor(context, SAFE_CONTEXT_KEY)) return unwrapped;
  if (escape) return escapeHtml(unwrapped);
  return unwrapped;
}

export { filters };
