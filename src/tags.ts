import { TextNode } from "./node.js";
import type {
  AccessorPath,
  Context,
  CustomTagUserHandler,
  ExprTagHandler,
  RenderFunction,
  ScannerLike,
  TagContentBlock,
  TagContentFunction,
  TagContentMap,
  TemplateNode
} from "./types.js";
import { compileFilterBody, literal, parseLiteral, SAFE_CONTEXT_KEY } from "./filter-parser.js";
import { filters } from "./filters.js";
import {
  assocIn,
  cljStr,
  cloneContext,
  deprecatedKeyLookup,
  ffind,
  getAccessor,
  getIn,
  getMissingValueFormatter,
  parseAccessor,
  seq
} from "./util.js";
import { readTagInfoFromString } from "./scanner.js";

export function createValueMappings(context: Context, ids: AccessorPath[], value: unknown): Context {
  if (ids.length === 1) return assocIn(context, ids[0], value);
  let mapped = cloneContext(context);
  const values = Array.isArray(value) || typeof value === "string" ? [...(value as Iterable<unknown>)] : seq(value);
  ids.forEach((path, idx) => {
    if (idx < values.length) mapped = assocIn(mapped, path, values[idx]);
  });
  return mapped;
}

export function aggregateArgs(args: string[]): [string[], ["in", string] | []] {
  const split = args.flatMap((arg) => arg.split(",")).filter((arg) => arg !== "");
  const index = split.indexOf("in");
  if (index < 0) return [split, []];
  return [split.slice(0, index), ["in", split[index + 1]]];
}

function compileFilters(items: string, filterNames: string[]): Array<(context: Context) => unknown> {
  return filterNames.map((filterName) => compileFilterBody(`${items}|${filterName}`, false));
}

function applyFilters(item: unknown, compiled: Array<(context: Context) => unknown>, context: Context, items: string): unknown {
  return compiled.reduce((value, filter) => filter({ ...(context as Record<string, unknown>), [items]: value }), item);
}

export const exprTags = new Map<string, ExprTagHandler>();
export const closingTags = new Map<string, string[]>();

function blockOf(map: TagContentMap, key: string): TagContentBlock | undefined {
  const value = map[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function blocksOf(map: TagContentMap, key: string): TagContentBlock[] {
  const value = map[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export const forHandler: ExprTagHandler = (args, tagContent, render, scanner) => {
  const content = tagContent(scanner, "for", "empty", "endfor");
  const forContent = blockOf(content, "for")?.content ?? [];
  const emptyContent = blockOf(content, "empty")?.content;
  const [rawIds, inPart] = aggregateArgs(args);
  const ids = rawIds.map(parseAccessor);
  const itemsExpr = inPart[1];
  const [items = "", ...filterNames] = (itemsExpr ?? "").split("|");
  const forItems = literal(items) ? `for-${items}` : items;
  const compiledFilters = compileFilters(forItems, filterNames);
  const itemKeys = parseAccessor(items);

  return (context) => {
    let output = "";
    const unfilteredItems = literal(items) ? parseLiteral(items) : getIn(context, itemKeys);
    if ((unfilteredItems === undefined || unfilteredItems === null) && !emptyContent) {
      return getMissingValueFormatter()({ tagType: "expr", tagName: "for", args: itemKeys.map(String) }, context);
    }
    const filteredItems = applyFilters(unfilteredItems, compiledFilters, context, forItems);
    const values = filteredItems === undefined || filteredItems === null ? [] : seq(filteredItems);
    if (emptyContent && values.length === 0) return render(emptyContent, context);
    const length = values.length;
    let previous: Context | undefined;
    values.forEach((item, counter) => {
      const valueContext = createValueMappings(context, ids, item);
      const loopInfo = {
        length,
        counter0: counter,
        counter: counter + 1,
        revcounter: length - (counter + 1),
        revcounter0: length - counter,
        first: counter === 0,
        last: counter === length - 1,
        parentloop: getAccessor(context, "forloop"),
        previous
      };
      const renderContext = { ...(valueContext as Record<string, unknown>), forloop: loopInfo };
      output += render(forContent, renderContext);
      previous = valueContext;
    });
    return output;
  };
};

export function ifResult(value: unknown): boolean {
  const v = Array.isArray(value) && (value[0] === ":safe" || value[0] === "safe") ? value[1] : value;
  if (v === null || v === undefined || v === "" || v === "false" || v === false) return false;
  return true;
}

function matchComparator(op: string): (a: number, b: number) => boolean {
  switch (op) {
    case ">":
      return (a, b) => a > b;
    case "<":
      return (a, b) => a < b;
    case "=":
      return (a, b) => a === b;
    case ">=":
      return (a, b) => a >= b;
    case "<=":
      return (a, b) => a <= b;
    default:
      throw new Error(`Unrecognized operator in 'if' statement: ${op}`);
  }
}

function numeric(value: string | unknown): boolean {
  return /^-?[0-9]*\.?[0-9]+$/.test(String(value));
}

function parseDouble(value: unknown): number {
  return Number.parseFloat(String(value));
}

function parseNumericParams(p1: string, op: string, p2: string): [((a: unknown, b?: unknown) => boolean), string | undefined, string | undefined] {
  const comparator = matchComparator(op);
  if (!numeric(p1) && !numeric(p2)) return [(a, b) => comparator(parseDouble(a), parseDouble(b)), p1, p2];
  if (numeric(p1)) return [(b) => comparator(parseDouble(p1), parseDouble(b)), undefined, p2];
  return [(a) => comparator(parseDouble(a), parseDouble(p2)), p1, undefined];
}

function numericExpressionEvaluation([comparator, contextKey1, contextKey2]: [
  (a: unknown, b?: unknown) => boolean,
  string | undefined,
  string | undefined
]): (context: Context) => boolean | undefined {
  const left = contextKey1 ? compileFilterBody(contextKey1) : undefined;
  const right = contextKey2 ? compileFilterBody(contextKey2) : undefined;
  return (context) => {
    const value1 = contextKey1 ? left?.(context) : undefined;
    const value2 = contextKey2 ? right?.(context) : undefined;
    if (value1 !== undefined && value1 !== null && value1 !== "" && value2 !== undefined && value2 !== null && value2 !== "") {
      return comparator(value1, value2);
    }
    if (value1 !== undefined && value1 !== null && value1 !== "") return comparator(value1);
    if (value2 !== undefined && value2 !== null && value2 !== "") return comparator(value2);
    return undefined;
  };
}

function ifAnyAllFn(kind: "any" | "all", params: string[]): (context: Context) => boolean {
  const compiled = params.map((param) => compileFilterBody(param));
  return (context) => kind === "any" ? compiled.some((f) => ifResult(f(context))) : compiled.every((f) => ifResult(f(context)));
}

export function parseEqArg(argString: string): string | ((context: Context) => unknown) {
  if (argString.startsWith('"')) return argString.slice(1, -1);
  if (argString.startsWith(":")) return argString;
  if (numeric(argString)) return argString;
  return compileFilterBody(argString);
}

function lookupIfNeeded(arg: string | ((context: Context) => unknown), context: Context): unknown {
  return typeof arg === "function" ? arg(context) : arg;
}

export function ifConditionFn(params0: string[]): (context: Context) => boolean {
  const negate = params0[0] === "not";
  const params = negate ? params0.slice(1) : params0;
  let evalFn: (context: Context) => unknown;

  if (params.length === 1) {
    evalFn = compileFilterBody(params[0]);
  } else if (params[0] === "any" || params[0] === "all") {
    evalFn = ifAnyAllFn(params[0], params.slice(1));
  } else if (params.length === 3 && params[1] === "=") {
    const [p1, , p3] = params;
    const a0 = parseEqArg(p1);
    const b0 = parseEqArg(p3);
    evalFn = (context) => {
      const a = lookupIfNeeded(a0, context);
      const b = lookupIfNeeded(b0, context);
      if (numeric(a) && numeric(b)) return parseDouble(a) === parseDouble(b);
      return a === b;
    };
  } else if (params.length === 3) {
    evalFn = numericExpressionEvaluation(parseNumericParams(params[0], params[1], params[2]));
  } else {
    evalFn = () => false;
  }

  return (context) => negate ? !ifResult(evalFn(context)) : ifResult(evalFn(context));
}

function renderIf(render: RenderFunction, context: Context, condition: boolean, success?: TagContentBlock, failure?: TagContentBlock): string {
  if (condition) return success ? render(success.content, context) : "";
  return failure ? render(failure.content, context) : "";
}

function compareTag(args: Array<string | ((context: Context) => unknown)>, comparator: (...values: unknown[]) => boolean, render: RenderFunction, success?: TagContentBlock, failure?: TagContentBlock): (context: Context) => string {
  return (context) => {
    const values = args.map((arg) => lookupIfNeeded(arg, context));
    return renderIf(render, context, comparator(...values), success, failure);
  };
}

export const ifHandler: ExprTagHandler = (params, tagContent, render, scanner) => {
  const content = tagContent(scanner, "if", "elif", "else", "endif");
  const clauses: Array<{ test: (context: Context) => boolean; content: TemplateNode[] }> = [];
  const ifBlock = blockOf(content, "if");
  if (ifBlock) clauses.push({ test: ifConditionFn(params), content: ifBlock.content });
  for (const elif of blocksOf(content, "elif")) clauses.push({ test: ifConditionFn(elif.args ?? []), content: elif.content });
  const elseBlock = blockOf(content, "else");
  if (elseBlock) clauses.push({ test: () => true, content: elseBlock.content });
  return (context) => render(ffind((clause) => clause.test(context), clauses)?.content ?? [], context);
};

function parseEqArgs(args: string[]): Array<string | ((context: Context) => unknown)> {
  return args.map(parseEqArg);
}

export const ifequalHandler: ExprTagHandler = (args, tagContent, render, scanner) => {
  const content = tagContent(scanner, "ifequal", "else", "endifequal");
  const parsed = parseEqArgs(args);
  return compareTag(parsed, (...values) => values.every((v) => v === values[0]), render, blockOf(content, "ifequal"), blockOf(content, "else"));
};

export const ifunequalHandler: ExprTagHandler = (args, tagContent, render, scanner) => {
  const content = tagContent(scanner, "ifunequal", "else", "endifunequal");
  const parsed = parseEqArgs(args);
  return compareTag(parsed, (...values) => !values.every((v) => v === values[0]), render, blockOf(content, "ifunequal"), blockOf(content, "else"));
};

export const blockHandler: ExprTagHandler = (_args, tagContent, render, scanner) => {
  const content = blockOf(tagContent(scanner, "block", "endblock"), "block")?.content ?? [];
  return (context) => render(content, context);
};

export const sumHandler: ExprTagHandler = (args) => (context) => {
  const total = args.reduce((sum, val) => {
    if (val.startsWith("\\")) return sum + Number(val.slice(1));
    return sum + Number(getIn(context, parseAccessor(val)) ?? 0);
  }, 0);
  return Number.isInteger(total) ? total : Number(total.toFixed(12));
};

export const nowHandler: ExprTagHandler = (args) => (_context) => filters.get("date")?.(new Date(), args.join(" "));

export const commentHandler: ExprTagHandler = (_args, tagContent, _render, scanner) => {
  tagContent(scanner, "comment", "endcomment");
  return () => "";
};

export const firstOfHandler: ExprTagHandler = (args) => {
  const compiled = args.map((arg) => compileFilterBody(arg));
  return (context) => {
    for (const f of compiled) {
      const value = f(context);
      if (ifResult(value) && !(Array.isArray(value) && value.length === 0)) return value;
    }
    return "";
  };
};

export function readVerbatim(scanner: ScannerLike): string {
  let buf = "";
  while (!scanner.eof()) {
    if (scanner.startsWith(scanner.delimiters.tagOpen + scanner.delimiters.tagSecond)) {
      const tag = scanner.readTagContent();
      const info = readTagInfoFromString(tag, scanner.delimiters);
      if (info.tagType === "expr" && info.tagName === "endverbatim") break;
      buf += tag;
    } else {
      buf += scanner.readChar() ?? "";
    }
  }
  return buf;
}

export const verbatimHandler: ExprTagHandler = (_args, _tagContent, _render, scanner) => {
  const content = readVerbatim(scanner);
  return () => content;
};

export function compileArgs(args: string[]): Array<[AccessorPath, (context: Context) => unknown]> {
  if (args.length % 2 !== 0) throw new Error(`invalid arguments passed to 'with' tag: ${args.join(" ")}`);
  const compiled: Array<[AccessorPath, (context: Context) => unknown]> = [];
  for (let i = 0; i < args.length; i += 2) compiled.push([parseAccessor(args[i]), compileFilterBody(args[i + 1], false)]);
  return compiled;
}

function compileArgsNamespaced(args: string[]): Array<[AccessorPath, (context: Context) => unknown]> {
  if (args.length % 2 !== 0) throw new Error(`invalid arguments passed to tag: ${args.join(" ")}`);
  const compiled: Array<[AccessorPath, (context: Context) => unknown]> = [];
  for (let i = 0; i < args.length; i += 2) compiled.push([[`selmer/${args[i]}`], compileFilterBody(args[i + 1], false)]);
  return compiled;
}

function splitAssignments(args: string[]): string[] {
  return args.join(" ").match(/"[^"]*"|[^=\s]+/g) ?? [];
}

export const withHandler: ExprTagHandler = (args, tagContent, render, scanner) => {
  const content = blockOf(tagContent(scanner, "with", "endwith"), "with")?.content ?? [];
  const compiled = compileArgs(splitAssignments(args));
  return (context) => {
    let updated = cloneContext(context);
    for (const [key, value] of compiled) updated = assocIn(updated, key, value(context));
    return render(content, updated);
  };
};

function buildUriForScriptOrStyleTag(uri: string, context: Context): string {
  const literalUri = uri.startsWith('"') && uri.endsWith('"');
  const rawUri = literalUri ? uri.replace(/"/g, "") : compileFilterBody(uri, false)(context);
  const ctx = getAccessor(context, "selmer/context");
  const uriStr = `${ctx ?? ""}${rawUri ?? ""}`;
  const match = /^(\/+)(.*)$/.exec(uriStr);
  if (match) return match[1] + match[2].replace(/\/\//g, "/");
  return uriStr;
}

export const scriptHandler: ExprTagHandler = ([uri = "", ...args]) => {
  const compiled = compileArgsNamespaced(args.flatMap((arg) => arg.split("=")).filter((arg) => arg !== "="));
  return (context) => {
    let updated = cloneContext(context);
    for (const [key, value] of compiled) updated = assocIn(updated, key, value(context));
    const asyncValue = getAccessor(updated, "selmer/async") !== undefined ? getAccessor(updated, "selmer/async") : deprecatedKeyLookup(updated, "selmer/async", "async");
    const deferValue = getAccessor(updated, "selmer/defer") !== undefined ? getAccessor(updated, "selmer/defer") : deprecatedKeyLookup(updated, "selmer/defer", "defer");
    const typeValue = getAccessor(updated, "selmer/type") ?? "application/javascript";
    const src = buildUriForScriptOrStyleTag(uri, context);
    return `<script ${asyncValue ? "async " : ""}${deferValue ? "defer " : ""}src="${src}" type="${typeValue}"></script>`;
  };
};

export const styleHandler: ExprTagHandler = ([uri = ""]) => (context) => {
  const href = buildUriForScriptOrStyleTag(uri, context);
  return `<link href="${href}" rel="stylesheet" type="text/css" />`;
};

export const cycleHandler: ExprTagHandler = (args) => {
  const fields = [...args];
  let i = 0;
  return () => {
    const val = fields[i];
    i = i < fields.length - 1 ? i + 1 : 0;
    return val;
  };
};

export const safeHandler: ExprTagHandler = (_args, tagContent, render, scanner) => {
  const content = blockOf(tagContent(scanner, "safe", "endsafe"), "safe")?.content ?? [];
  return (context) => render(content, { ...(context as Record<string, unknown>), [SAFE_CONTEXT_KEY]: true });
};

export function prettyPrint(value: unknown): string {
  return cljStr(value);
}

export function basicEdnToHtml(context: Context): string {
  return `<pre>Include yogthos/json-html for prettier debugging.\n${String(prettyPrint(context)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
}

export const debugHandler: ExprTagHandler = () => (context) => basicEdnToHtml(context);

const builtInTags: Record<string, ExprTagHandler | undefined> = {
  if: ifHandler,
  ifequal: ifequalHandler,
  ifunequal: ifunequalHandler,
  sum: sumHandler,
  for: forHandler,
  block: blockHandler,
  cycle: cycleHandler,
  now: nowHandler,
  comment: commentHandler,
  firstof: firstOfHandler,
  verbatim: verbatimHandler,
  with: withHandler,
  script: scriptHandler,
  style: styleHandler,
  safe: safeHandler,
  debug: debugHandler,
  extends: undefined,
  include: undefined
};

for (const [name, handler] of Object.entries(builtInTags)) if (handler) exprTags.set(name, handler);
exprTags.set("extends", undefined as unknown as ExprTagHandler);
exprTags.set("include", undefined as unknown as ExprTagHandler);

const builtInClosing: Record<string, string[]> = {
  if: ["elif", "else", "endif"],
  elif: ["elif", "else", "endif"],
  else: ["endif", "endifequal", "endifunequal"],
  ifequal: ["else", "endifequal"],
  ifunequal: ["else", "endifunequal"],
  block: ["endblock"],
  for: ["empty", "endfor"],
  empty: ["endfor"],
  comment: ["endcomment"],
  safe: ["endsafe"],
  verbatim: ["endverbatim"],
  with: ["endwith"]
};
for (const [name, tags] of Object.entries(builtInClosing)) closingTags.set(name, tags);

export function renderTags(context: Context, tags: TagContentMap): Record<string, any> {
  const result: Record<string, any> = {};
  const renderBlock = (block: TagContentBlock) => ({
    ...block,
    content: block.content.map((node) => cljStr(node.renderNode(context))).join("")
  });
  for (const [tag, content] of Object.entries(tags)) {
    if (Array.isArray(content)) result[tag] = content.map(renderBlock);
    else if (content) result[tag] = renderBlock(content);
  }
  return result;
}

export function tagHandler(handler: CustomTagUserHandler, ...tags: string[]): ExprTagHandler {
  return (args, tagContent, render, scanner) => {
    if (tags.length > 1) {
      const content = tagContent(scanner, tags[0], ...tags.slice(1));
      return (context) => render([new TextNode(cljStr(handler(args, context, renderTags(context, content))))], context);
    }
    return (context) => handler(args, context);
  };
}

export function setClosingTags(...tags: string[]): void {
  for (let i = 0; i < tags.length; i += 1) {
    const tag = tags[i];
    const rest = tags.slice(i + 1);
    closingTags.set(tag, [...(closingTags.get(tag) ?? []), ...rest]);
  }
}

export function addTag(name: string, handler: CustomTagUserHandler, ...tags: string[]): void {
  const tagName = name.startsWith(":") ? name.slice(1) : name;
  setClosingTags(tagName, ...tags);
  exprTags.set(tagName, tagHandler(handler, tagName, ...tags));
}

export const addTag$ = addTag;

export function removeTag(name: string): void {
  const tagName = name.startsWith(":") ? name.slice(1) : name;
  exprTags.delete(tagName);
  closingTags.delete(tagName);
}

export const removeTag$ = removeTag;
