from __future__ import annotations

from typing import Any, Callable

from .filter_parser import compile_filter_body, literal, parse_literal, split_value
from .filters import add_filter
from .node import FunctionNode, TextNode
from .scanner import Scanner
from .tags import aggregate_args, expr_tags
from .template_parser import preprocess_template_file, preprocess_template_string
from .types import Context, ExprTagInfo, FilterTagInfo, RenderFunction, TagContentBlock, TagContentMap, TagInfo, TemplateNode
from .util import clj_str, get_missing_value_formatter, make_delimiters, parse_accessor, read_resource, resource_path, set_resource_path as _set_resource_path

ParsedTemplate = list[TemplateNode]
templates: dict[str, dict[str, Any]] = {}
_cache_enabled = True


def clear_cache() -> None:
    templates.clear()


clear_cache_bang = clear_cache


def cache_on() -> None:
    global _cache_enabled
    _cache_enabled = True


cache_on_bang = cache_on


def cache_off() -> None:
    global _cache_enabled
    clear_cache()
    _cache_enabled = False


cache_off_bang = cache_off


def set_resource_path(path: str | None) -> None:
    _set_resource_path(path)


set_resource_path_bang = set_resource_path


def _apply_customs(opts: dict[str, Any]) -> None:
    for name, handler in (opts.get("custom_tags") or opts.get("customTags") or {}).items():
        expr_tags[name[1:] if str(name).startswith(":") else str(name)] = handler
    for name, handler in (opts.get("custom_filters") or opts.get("customFilters") or {}).items():
        add_filter(str(name), handler)


def render_template(template: list[TemplateNode], context: Context) -> str:
    out = ""
    for element in template:
        value = element.render_node(context)
        if value is None:
            tag = element.meta.get("tag") if isinstance(element, FunctionNode) and element.meta else None
            out += clj_str(get_missing_value_formatter()(tag or {"tag_value": None}, context))
        else:
            out += clj_str(value)
    return out


def render(s: str, context: Context | None = None, **opts: Any) -> str:
    return render_template(parse_string(s, **opts), context or {})


def render_file(filename_or_url: str, context: Context | None = None, **opts: Any) -> str:
    use_cache = opts.get("cache", _cache_enabled)
    resource = resource_path(filename_or_url, **opts)
    if not resource:
        raise FileNotFoundError(
            f"resource-path for {filename_or_url} returned nil, typically means the file doesn't exist in your classpath."
        )
    last_modified = resource.get("last_modified", -1.0)
    cached = templates.get(resource["path"])
    if use_cache and cached and cached.get("last_modified") == last_modified:
        return render_template(cached["template"], context or {})
    template = parse_file(filename_or_url, **opts)
    templates[resource["path"]] = {"template": template, "last_modified": last_modified}
    return render_template(template, context or {})


def parse_string(input_value: str, **opts: Any) -> ParsedTemplate:
    return _compile_source(preprocess_template_string(input_value, **opts), opts)


parse_str = parse_string


def parse_file(file: str, **opts: Any) -> ParsedTemplate:
    return _compile_source(preprocess_template_file(file, **opts), opts)


def parse_input(input_value: str, **opts: Any) -> ParsedTemplate:
    delimiters = make_delimiters(**opts)
    source = read_resource(input_value, **opts)[0] if _should_treat_input_as_path(input_value, opts, delimiters) else input_value
    return _compile_source(source, opts, delimiters)


def parse(parse_fn: Callable[..., ParsedTemplate], input_value: str, **opts: Any) -> ParsedTemplate:
    return parse_fn(input_value, **opts)


def _compile_source(source: str, opts: dict[str, Any], delimiters: Any | None = None) -> ParsedTemplate:
    _apply_customs(opts)
    all_tags: list[TagInfo] = []
    scanner = Scanner(source, delimiters or make_delimiters(**opts), all_tags)
    parsed = _parse_scanner(scanner, opts, all_tags)
    setattr(parsed, "all_tags", all_tags)  # list subclasses only; fallback below if needed
    return parsed


class _ParsedTemplate(list[TemplateNode]):
    all_tags: list[TagInfo]


def _parse_scanner(scanner: Scanner, opts: dict[str, Any], all_tags: list[TagInfo]) -> _ParsedTemplate:
    template: _ParsedTemplate = _ParsedTemplate()
    buf = ""
    while not scanner.eof():
        if scanner.starts_short_comment():
            scanner.skip_short_comment()
            continue
        if scanner.starts_tag():
            if buf:
                template.append(TextNode(buf))
                buf = ""
            tag = scanner.read_tag_info()
            template.append(FunctionNode(parse_tag(tag, scanner, opts, all_tags)))
        else:
            buf += scanner.read_char() or ""
    template.append(TextNode(buf))
    return template


def _should_treat_input_as_path(input_value: str, opts: dict[str, Any], delimiters: Any) -> bool:
    if "\n" in input_value:
        return False
    if delimiters.tag_open + delimiters.filter_open in input_value or delimiters.tag_open + delimiters.tag_second in input_value:
        return False
    return resource_path(input_value, **opts) is not None


def expr_tag(tag: ExprTagInfo, scanner: Scanner, opts: dict[str, Any], all_tags: list[TagInfo]) -> Callable[[Context], Any]:
    handler = expr_tags.get(tag.tag_name)
    if handler is None:
        raise ValueError(f"unrecognized tag: {tag.tag_name} - did you forget to close a tag?")
    return handler(tag.args, lambda s, start, *end: tag_content(s, start, *end, opts=opts, all_tags=all_tags), render_template, scanner)


def filter_tag(tag: FilterTagInfo) -> Callable[[Context], Any]:
    return compile_filter_body(tag.tag_value)


def parse_tag(tag: TagInfo, scanner: Scanner, opts: dict[str, Any], all_tags: list[TagInfo]) -> Callable[[Context], Any]:
    handler = filter_tag(tag) if tag.tag_type == "filter" else expr_tag(tag, scanner, opts, all_tags)  # type: ignore[arg-type]
    setattr(handler, "meta", {"tag": tag})
    return handler


def _append_node(content: list[TemplateNode], tag: TagInfo, buf: str, scanner: Scanner, opts: dict[str, Any], all_tags: list[TagInfo]) -> list[TemplateNode]:
    return [*content, TextNode(buf), FunctionNode(parse_tag(tag, scanner, opts, all_tags))]


def _ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _update_tags(tag: str, tags_map: TagContentMap, content: list[TemplateNode], args: list[str] | None, buf: str) -> TagContentMap:
    block = TagContentBlock([*content, TextNode(buf)], args)
    existing = tags_map.get(tag)
    updated = dict(tags_map)
    if existing is not None:
        updated[tag] = [*_ensure_list(existing), block]
    else:
        updated[tag] = block
    return updated


def tag_content(scanner: Scanner, start_tag: str, *end_tags0: str, opts: dict[str, Any] | None = None, all_tags: list[TagInfo] | None = None) -> TagContentMap:
    opts = opts or {}
    all_tags = all_tags or []
    tags_map: TagContentMap = {}
    content: list[TemplateNode] = []
    cur_tag = start_tag
    end_tags = list(end_tags0)
    cur_args: list[str] | None = None
    buf = ""
    while True:
        if scanner.eof():
            if end_tags:
                raise ValueError(f"No closing tag found for {start_tag}")
            return tags_map
        if scanner.starts_short_comment():
            scanner.skip_short_comment()
            continue
        if scanner.starts_tag():
            tag = scanner.read_tag_info()
            tag_name = tag.tag_name if tag.tag_type == "expr" else None  # type: ignore[attr-defined]
            end_index = end_tags.index(tag_name) if tag_name in end_tags else -1
            if end_index >= 0 and tag_name:
                tags_map = _update_tags(cur_tag, tags_map, content, cur_args, buf)
                buf = ""
                content = []
                cur_tag = tag_name
                cur_args = tag.args if tag.tag_type == "expr" else None  # type: ignore[attr-defined]
                if tag_name != "elif":
                    end_tags = end_tags[end_index + 1 :]
                if not end_tags:
                    return tags_map
            else:
                content = _append_node(content, tag, buf, scanner, opts, all_tags)
                buf = ""
        else:
            buf += scanner.read_char() or ""


def _split_value_local(s: str) -> list[str]:
    result: list[str] = []
    buf = ""
    quoted = False
    for ch in s:
        if ch == '"':
            quoted = not quoted
        if not quoted and ch == "|":
            result.append(buf.strip())
            buf = ""
        else:
            buf += ch
    result.append(buf.strip())
    return [part for part in result if part]


def _parse_variable_paths(arg: str) -> list[str | int] | None:
    values = _split_value_local(arg)
    return parse_accessor(values[0]) if values else None


def _parse_variables(tags: list[TagInfo]) -> list[list[str | int]]:
    vars_map: dict[str, list[str | int]] = {}
    nested_keys: set[str | int] = set()

    def add(path: list[str | int] | None) -> None:
        if path:
            vars_map[str(path)] = path

    for tag in tags:
        if tag.tag_type == "filter":
            v = _parse_variable_paths(tag.tag_value)  # type: ignore[attr-defined]
            if v and v[0] not in nested_keys:
                add(v)
        elif tag.tag_name == "for":  # type: ignore[attr-defined]
            ids, in_part = aggregate_args(tag.args)  # type: ignore[attr-defined]
            add(_parse_variable_paths(in_part[1] if in_part else ""))
            nested_keys = {parse_accessor(item)[0] for item in ids} | {"forloop"}
        elif tag.tag_name == "with":  # type: ignore[attr-defined]
            first = tag.args[0] if tag.args else ""  # type: ignore[attr-defined]
            parts = first.split("=", 1)
            if len(parts) == 2:
                add(_parse_variable_paths(parts[1]))
                nested_keys = {parse_accessor(parts[0])[0]}
        elif tag.tag_name in {"endfor", "endwith"}:  # type: ignore[attr-defined]
            nested_keys = set()
        else:
            special = {None, "not", "all", "any", "<", ">", "=", "<=", ">="}
            for arg in tag.args:  # type: ignore[attr-defined]
                if literal(arg):
                    continue
                v = _parse_variable_paths(arg)
                if not v or v[0] in special or v[0] in nested_keys:
                    continue
                add(v)
    return list(vars_map.values())


def known_variable_paths(input_value: str, **opts: Any) -> list[list[str | int]]:
    parsed = parse_input(input_value, **opts)
    return _parse_variables(getattr(parsed, "all_tags", []))


def known_variables(input_value: str, **opts: Any) -> set[str | int]:
    return {path[0] for path in known_variable_paths(input_value, **opts)}


def resolve_arg(arg: str, context: Context) -> Any:
    return parse_literal(arg) if literal(arg) else render(arg, context)
