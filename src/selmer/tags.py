from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Callable

from .filter_parser import SAFE_CONTEXT_KEY, compile_filter_body, literal, parse_literal
from .filters import filters
from .node import TextNode
from .scanner import read_tag_info_from_string
from .types import AccessorPath, Context, ExprTagHandler, RenderFunction, TagContentBlock, TagContentMap, TemplateNode
from .util import (
    assoc_in,
    clj_str,
    clone_context,
    deprecated_key_lookup,
    ffind,
    get_accessor,
    get_in,
    get_missing_value_formatter,
    parse_accessor,
    seq,
)

expr_tags: dict[str, ExprTagHandler | None] = {}
closing_tags: dict[str, list[str]] = {}


def create_value_mappings(context: Context, ids: list[AccessorPath], value: Any) -> dict[Any, Any]:
    if len(ids) == 1:
        return assoc_in(context, ids[0], value)
    mapped: dict[Any, Any] = dict(context)
    values = list(value) if isinstance(value, (list, tuple, str)) else seq(value)
    for idx, path in enumerate(ids):
        if idx < len(values):
            mapped = assoc_in(mapped, path, values[idx])
    return mapped


def aggregate_args(args: list[str]) -> tuple[list[str], tuple[str, str] | tuple[()]]:
    split = [part for arg in args for part in arg.split(",") if part != ""]
    if "in" not in split:
        return split, ()
    idx = split.index("in")
    return split[:idx], ("in", split[idx + 1] if idx + 1 < len(split) else "")


def _block_of(content: TagContentMap, key: str) -> TagContentBlock | None:
    value = content.get(key)
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _blocks_of(content: TagContentMap, key: str) -> list[TagContentBlock]:
    value = content.get(key)
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def compile_filters(items: str, filter_names: list[str]) -> list[Callable[[Context], Any]]:
    return [compile_filter_body(f"{items}|{filter_name}", False) for filter_name in filter_names]


def apply_filters(item: Any, compiled: list[Callable[[Context], Any]], context: Context, items: str) -> Any:
    value = item
    for filt in compiled:
        value = filt({**dict(context), items: value})
    return value


def for_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], Any]:
    content = tag_content(scanner, "for", "empty", "endfor")
    for_content = (_block_of(content, "for") or TagContentBlock([])).content
    empty_content = _block_of(content, "empty")
    raw_ids, in_part = aggregate_args(args)
    ids = [parse_accessor(item) for item in raw_ids]
    items_expr = in_part[1] if in_part else ""
    item_parts = items_expr.split("|")
    items = item_parts[0]
    filter_names = item_parts[1:]
    for_items = f"for-{items}" if literal(items) else items
    compiled = compile_filters(for_items, filter_names)
    item_keys = parse_accessor(items)

    def run(context: Context) -> Any:
        unfiltered_items = parse_literal(items) if literal(items) else get_in(context, item_keys)
        if unfiltered_items is None and empty_content is None:
            return get_missing_value_formatter()({"tag_type": "expr", "tag_name": "for", "args": item_keys}, context)
        filtered = apply_filters(unfiltered_items, compiled, context, for_items)
        values = [] if filtered is None else seq(filtered)
        if empty_content is not None and not values:
            return render(empty_content.content, context)
        out = ""
        length = len(values)
        previous: dict[Any, Any] | None = None
        for counter, item in enumerate(values):
            value_context = create_value_mappings(context, ids, item)
            loop_info = {
                "length": length,
                "counter0": counter,
                "counter": counter + 1,
                "revcounter": length - (counter + 1),
                "revcounter0": length - counter,
                "first": counter == 0,
                "last": counter == length - 1,
                "parentloop": get_accessor(context, "forloop"),
                "previous": previous,
            }
            render_context = {**value_context, "forloop": loop_info}
            out += render(for_content, render_context)
            previous = value_context
        return out

    return run


def if_result(value: Any) -> bool:
    if isinstance(value, (list, tuple)) and len(value) >= 2 and value[0] in {":safe", "safe"}:
        value = value[1]
    return not (value is None or value == "" or value == "false" or value is False)


def _numeric(value: Any) -> bool:
    return bool(re.fullmatch(r"-?[0-9]*\.?[0-9]+", str(value)))


def _parse_double(value: Any) -> float:
    return float(str(value))


def _match_comparator(op: str) -> Callable[[float, float], bool]:
    if op == ">":
        return lambda a, b: a > b
    if op == "<":
        return lambda a, b: a < b
    if op == "=":
        return lambda a, b: a == b
    if op == ">=":
        return lambda a, b: a >= b
    if op == "<=":
        return lambda a, b: a <= b
    raise ValueError(f"Unrecognized operator in 'if' statement: {op}")


def parse_numeric_params(p1: str, op: str, p2: str) -> tuple[Callable[..., bool], str | None, str | None]:
    comparator = _match_comparator(op)
    if not _numeric(p1) and not _numeric(p2):
        return lambda a, b: comparator(_parse_double(a), _parse_double(b)), p1, p2
    if _numeric(p1):
        return lambda b: comparator(_parse_double(p1), _parse_double(b)), None, p2
    return lambda a: comparator(_parse_double(a), _parse_double(p2)), p1, None


def numeric_expression_evaluation(params: tuple[Callable[..., bool], str | None, str | None]) -> Callable[[Context], bool | None]:
    comparator, key1, key2 = params
    left = compile_filter_body(key1) if key1 else None
    right = compile_filter_body(key2) if key2 else None

    def run(context: Context) -> bool | None:
        value1 = left(context) if left else None
        value2 = right(context) if right else None
        has1 = value1 is not None and value1 != ""
        has2 = value2 is not None and value2 != ""
        if has1 and has2:
            return comparator(value1, value2)
        if has1:
            return comparator(value1)
        if has2:
            return comparator(value2)
        return None

    return run


def if_any_all_fn(kind: str, params: list[str]) -> Callable[[Context], bool]:
    compiled = [compile_filter_body(param) for param in params]
    if kind == "any":
        return lambda context: any(if_result(f(context)) for f in compiled)
    return lambda context: all(if_result(f(context)) for f in compiled)


def parse_eq_arg(arg_string: str) -> str | Callable[[Context], Any]:
    if arg_string.startswith('"'):
        return arg_string[1:-1]
    if arg_string.startswith(":"):
        return arg_string
    if _numeric(arg_string):
        return arg_string
    return compile_filter_body(arg_string)


def _lookup_if_needed(arg: str | Callable[[Context], Any], context: Context) -> Any:
    return arg(context) if callable(arg) else arg


def if_condition_fn(params0: list[str]) -> Callable[[Context], bool]:
    negate = bool(params0 and params0[0] == "not")
    params = params0[1:] if negate else params0
    if len(params) == 1:
        eval_fn = compile_filter_body(params[0])
    elif params and params[0] in {"any", "all"}:
        eval_fn = if_any_all_fn(params[0], params[1:])
    elif len(params) == 3 and params[1] == "=":
        left = parse_eq_arg(params[0])
        right = parse_eq_arg(params[2])

        def eval_fn(context: Context) -> bool:  # type: ignore[no-redef]
            a = _lookup_if_needed(left, context)
            b = _lookup_if_needed(right, context)
            if _numeric(a) and _numeric(b):
                return _parse_double(a) == _parse_double(b)
            return a == b

    elif len(params) == 3:
        eval_fn = numeric_expression_evaluation(parse_numeric_params(params[0], params[1], params[2]))
    else:
        eval_fn = lambda context: False
    return (lambda context: not if_result(eval_fn(context))) if negate else (lambda context: if_result(eval_fn(context)))


def _render_if(render: RenderFunction, context: Context, condition: bool, success: TagContentBlock | None, failure: TagContentBlock | None) -> str:
    if condition:
        return render(success.content, context) if success else ""
    return render(failure.content, context) if failure else ""


def _compare_tag(args: list[str | Callable[[Context], Any]], comparator: Callable[..., bool], render: RenderFunction, success: TagContentBlock | None, failure: TagContentBlock | None) -> Callable[[Context], str]:
    def run(context: Context) -> str:
        values = [_lookup_if_needed(arg, context) for arg in args]
        return _render_if(render, context, comparator(*values), success, failure)

    return run


def if_handler(params: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    content = tag_content(scanner, "if", "elif", "else", "endif")
    clauses: list[dict[str, Any]] = []
    if_block = _block_of(content, "if")
    if if_block:
        clauses.append({"test": if_condition_fn(params), "content": if_block.content})
    for elif_block in _blocks_of(content, "elif"):
        clauses.append({"test": if_condition_fn(elif_block.args or []), "content": elif_block.content})
    else_block = _block_of(content, "else")
    if else_block:
        clauses.append({"test": lambda context: True, "content": else_block.content})

    def run(context: Context) -> str:
        clause = ffind(lambda item: item["test"](context), clauses)
        return render(clause["content"] if clause else [], context)

    return run


def _parse_eq_args(args: list[str]) -> list[str | Callable[[Context], Any]]:
    return [parse_eq_arg(arg) for arg in args]


def ifequal_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    content = tag_content(scanner, "ifequal", "else", "endifequal")
    parsed = _parse_eq_args(args)
    return _compare_tag(parsed, lambda *values: all(value == values[0] for value in values), render, _block_of(content, "ifequal"), _block_of(content, "else"))


def ifunequal_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    content = tag_content(scanner, "ifunequal", "else", "endifunequal")
    parsed = _parse_eq_args(args)
    return _compare_tag(parsed, lambda *values: not all(value == values[0] for value in values), render, _block_of(content, "ifunequal"), _block_of(content, "else"))


def block_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    content = (_block_of(tag_content(scanner, "block", "endblock"), "block") or TagContentBlock([])).content
    return lambda context: render(content, context)


def sum_handler(args: list[str], *_: Any) -> Callable[[Context], Any]:
    def run(context: Context) -> Any:
        total = 0.0
        use_float = False
        for val in args:
            if val.startswith("\\"):
                n = float(val[1:]) if "." in val else int(val[1:])
            else:
                n = get_in(context, parse_accessor(val)) or 0
            if isinstance(n, float):
                use_float = True
            total += float(n)
        return int(total) if not use_float and total.is_integer() else float(f"{total:.12g}")

    return run


def now_handler(args: list[str], *_: Any) -> Callable[[Context], Any]:
    return lambda context: filters["date"](datetime.now(), " ".join(args))


def comment_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    tag_content(scanner, "comment", "endcomment")
    return lambda context: ""


def first_of_handler(args: list[str], *_: Any) -> Callable[[Context], Any]:
    compiled = [compile_filter_body(arg) for arg in args]

    def run(context: Context) -> Any:
        for filt in compiled:
            value = filt(context)
            if if_result(value) and value != []:
                return value
        return ""

    return run


def read_verbatim(scanner: Any) -> str:
    buf = ""
    d = scanner.delimiters
    while not scanner.eof():
        if scanner.startswith(d.tag_open + d.tag_second):
            tag = scanner.read_tag_content()
            info = read_tag_info_from_string(tag, d)
            if getattr(info, "tag_type", None) == "expr" and getattr(info, "tag_name", None) == "endverbatim":
                break
            buf += tag
        else:
            buf += scanner.read_char() or ""
    return buf


def verbatim_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    content = read_verbatim(scanner)
    return lambda context: content


def compile_args(args: list[str]) -> list[tuple[AccessorPath, Callable[[Context], Any]]]:
    if len(args) % 2 != 0:
        raise ValueError(f"invalid arguments passed to 'with' tag: {' '.join(args)}")
    return [(parse_accessor(args[i]), compile_filter_body(args[i + 1], False)) for i in range(0, len(args), 2)]


def _compile_args_namespaced(args: list[str]) -> list[tuple[AccessorPath, Callable[[Context], Any]]]:
    if len(args) % 2 != 0:
        raise ValueError(f"invalid arguments passed to tag: {' '.join(args)}")
    return [([f"selmer/{args[i]}"], compile_filter_body(args[i + 1], False)) for i in range(0, len(args), 2)]


def _split_assignments(args: list[str]) -> list[str]:
    return re.findall(r'"[^"]*"|[^=\s]+', " ".join(args))


def with_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    content = (_block_of(tag_content(scanner, "with", "endwith"), "with") or TagContentBlock([])).content
    compiled = compile_args(_split_assignments(args))

    def run(context: Context) -> str:
        updated = dict(context)
        for key, value in compiled:
            updated = assoc_in(updated, key, value(context))
        return render(content, updated)

    return run


def _build_uri_for_script_or_style_tag(uri: str, context: Context) -> str:
    literal_uri = uri.startswith('"') and uri.endswith('"')
    raw_uri = uri.replace('"', "") if literal_uri else compile_filter_body(uri, False)(context)
    uri_str = f"{get_accessor(context, 'selmer/context') or ''}{raw_uri or ''}"
    match = re.match(r"^(/+)(.*)$", uri_str)
    return match.group(1) + match.group(2).replace("//", "/") if match else uri_str


def script_handler(args: list[str], *_: Any) -> Callable[[Context], str]:
    uri = args[0] if args else ""
    raw_args = [part for arg in args[1:] for part in arg.split("=") if part != "="]
    compiled = _compile_args_namespaced(raw_args)

    def run(context: Context) -> str:
        updated = dict(context)
        for key, value in compiled:
            updated = assoc_in(updated, key, value(context))
        async_value = get_accessor(updated, "selmer/async") if get_accessor(updated, "selmer/async") is not None else deprecated_key_lookup(updated, "selmer/async", "async")
        defer_value = get_accessor(updated, "selmer/defer") if get_accessor(updated, "selmer/defer") is not None else deprecated_key_lookup(updated, "selmer/defer", "defer")
        type_value = get_accessor(updated, "selmer/type") or "application/javascript"
        src = _build_uri_for_script_or_style_tag(uri, context)
        return f"<script {'async ' if async_value else ''}{'defer ' if defer_value else ''}src=\"{src}\" type=\"{type_value}\"></script>"

    return run


def style_handler(args: list[str], *_: Any) -> Callable[[Context], str]:
    uri = args[0] if args else ""
    return lambda context: f"<link href=\"{_build_uri_for_script_or_style_tag(uri, context)}\" rel=\"stylesheet\" type=\"text/css\" />"


def cycle_handler(args: list[str], *_: Any) -> Callable[[Context], Any]:
    fields = list(args)
    i = 0

    def run(context: Context) -> Any:
        nonlocal i
        val = fields[i]
        i = i + 1 if i < len(fields) - 1 else 0
        return val

    return run


def safe_handler(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], str]:
    content = (_block_of(tag_content(scanner, "safe", "endsafe"), "safe") or TagContentBlock([])).content
    return lambda context: render(content, {**dict(context), SAFE_CONTEXT_KEY: True})


def pretty_print(value: Any) -> str:
    return clj_str(value)


def basic_edn_to_html(context: Context) -> str:
    escaped = pretty_print(context).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"<pre>Include yogthos/json-html for prettier debugging.\n{escaped}</pre>"


def debug_handler(*_: Any) -> Callable[[Context], str]:
    return lambda context: basic_edn_to_html(context)


def render_tags(context: Context, tags: TagContentMap) -> dict[str, Any]:
    result: dict[str, Any] = {}

    def render_block(block: TagContentBlock) -> dict[str, Any]:
        return {"args": block.args, "content": "".join(clj_str(node.render_node(context)) for node in block.content)}

    for tag, content in tags.items():
        result[tag] = [render_block(block) for block in content] if isinstance(content, list) else render_block(content)
    return result


def tag_handler(handler: Callable[..., Any], *tags: str) -> ExprTagHandler:
    def wrapped(args: list[str], tag_content: Callable[..., TagContentMap], render: RenderFunction, scanner: Any) -> Callable[[Context], Any]:
        if len(tags) > 1:
            content = tag_content(scanner, tags[0], *tags[1:])
            return lambda context: render([TextNode(clj_str(handler(args, context, render_tags(context, content))))], context)
        return lambda context: handler(args, context)

    return wrapped


def set_closing_tags(*tags: str) -> None:
    for i, tag in enumerate(tags):
        closing_tags[tag] = [*closing_tags.get(tag, []), *tags[i + 1 :]]


set_closing_tags_bang = set_closing_tags


def add_tag(name: str, handler: Callable[..., Any], *tags: str) -> None:
    tag_name = name[1:] if name.startswith(":") else name
    set_closing_tags(tag_name, *tags)
    expr_tags[tag_name] = tag_handler(handler, tag_name, *tags)


add_tag_bang = add_tag


def remove_tag(name: str) -> None:
    tag_name = name[1:] if name.startswith(":") else name
    expr_tags.pop(tag_name, None)
    closing_tags.pop(tag_name, None)


remove_tag_bang = remove_tag


expr_tags.update(
    {
        "if": if_handler,
        "ifequal": ifequal_handler,
        "ifunequal": ifunequal_handler,
        "sum": sum_handler,
        "for": for_handler,
        "block": block_handler,
        "cycle": cycle_handler,
        "now": now_handler,
        "comment": comment_handler,
        "firstof": first_of_handler,
        "verbatim": verbatim_handler,
        "with": with_handler,
        "script": script_handler,
        "style": style_handler,
        "safe": safe_handler,
        "debug": debug_handler,
        "extends": None,
        "include": None,
    }
)

closing_tags.update(
    {
        "if": ["elif", "else", "endif"],
        "elif": ["elif", "else", "endif"],
        "else": ["endif", "endifequal", "endifunequal"],
        "ifequal": ["else", "endifequal"],
        "ifunequal": ["else", "endifunequal"],
        "block": ["endblock"],
        "for": ["empty", "endfor"],
        "empty": ["endfor"],
        "comment": ["endcomment"],
        "safe": ["endsafe"],
        "verbatim": ["endverbatim"],
        "with": ["endwith"],
    }
)
