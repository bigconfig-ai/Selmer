from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .scanner import Scanner, read_tag_info_from_string, tag_inner_content
from .types import Delimiters
from .util import (
    expression_close,
    expression_open,
    make_delimiters,
    read_resource,
    variable_close,
    variable_open,
)
from .validator import validate


@dataclass
class BlockInfo:
    super: bool
    content: str


Blocks = dict[str, BlockInfo]
Defaults = dict[str, str] | None


class Buffer:
    def __init__(self) -> None:
        self.value = ""

    def append(self, value: str | None) -> None:
        if value is not None:
            self.value += value

    def __str__(self) -> str:
        return self.value


def _tag_info(tag_str: str, delimiters: Delimiters):
    return read_tag_info_from_string(tag_str, delimiters)


def get_tag_params(tag_id: str, block_str: str, **opts: Any) -> str:
    d = make_delimiters(**opts)
    info = _tag_info(block_str, d)
    if getattr(info, "tag_type", None) != "expr" or getattr(info, "tag_name", None) != tag_id:
        return ""
    return " ".join(getattr(info, "args", [])).strip()


def parse_defaults(default_parts: list[str] | None) -> Defaults:
    if not default_parts:
        return None
    joined = " ".join(default_parts)
    return {match.group(1): match.group(2) for match in re.finditer(r'([^=\s]+)\s*=\s*"([^"]*)"', joined)}


def split_include_tag(tag_str: str, **opts: Any) -> list[str]:
    params = get_tag_params("include", tag_str.replace("\\", "/"), **opts)
    return re.findall(r'"[^"]*"|[^\s]+', params)


def get_parent(tag_str: str, **opts: Any) -> str:
    template = get_tag_params("extends", tag_str, **opts)
    return template[1:-1] if template.startswith('"') and template.endswith('"') else template


def _classify_tag(tag_str: str, delimiters: Delimiters) -> dict[str, Any]:
    info = _tag_info(tag_str, delimiters)
    is_expr = getattr(info, "tag_type", None) == "expr"
    is_filter = getattr(info, "tag_type", None) == "filter"
    tag_name = getattr(info, "tag_name", None)
    return {
        "info": info,
        "include": is_expr and tag_name == "include",
        "extends": is_expr and tag_name == "extends",
        "block": is_expr and tag_name == "block",
        "endblock": is_expr and tag_name == "endblock",
        "block_name": " ".join(getattr(info, "args", [])).strip() if is_expr and tag_name == "block" else None,
        "super_tag": is_filter and getattr(info, "tag_value", "").strip() == "block.super",
    }


def _write_tag(super_tag: bool, existing_block: BlockInfo | None, blocks_to_close: int, omit_close_tag: bool) -> bool:
    return super_tag or (existing_block is None and blocks_to_close > (1 if omit_close_tag else 0))


def _process_includes(tag_str: str, blocks: Blocks, opts: dict[str, Any]) -> str:
    params = split_include_tag(tag_str, **opts)
    source = (params[0] if params else "").replace('"', "")
    defaults = parse_defaults(params[2:])
    return preprocess_template_file(source, blocks=blocks, defaults=defaults, **opts)


def _starts_tag(scanner: Scanner) -> bool:
    d = scanner.delimiters
    return scanner.startswith(d.tag_open + d.filter_open) or scanner.startswith(d.tag_open + d.tag_second)


def consume_block(scanner: Scanner, buf: Buffer | None = None, blocks: Blocks | None = None, omit_close_tag: bool = False, **opts: Any) -> bool:
    blocks = blocks or {}
    blocks_to_close = 1
    has_super = False
    d = scanner.delimiters
    while blocks_to_close > 0 and not scanner.eof():
        if _starts_tag(scanner):
            tag_str = scanner.read_tag_content()
            tag = _classify_tag(tag_str, d)
            block_name = tag["block_name"]
            existing_block = blocks.get(block_name) if block_name else None
            if buf is not None:
                if tag["include"]:
                    buf.append(_process_includes(tag_str, blocks, opts))
                elif _write_tag(tag["super_tag"], existing_block, blocks_to_close, omit_close_tag):
                    buf.append(tag_str)
            if existing_block and block_name:
                consume_block(scanner, blocks=blocks, **opts)
                nested_blocks = dict(blocks)
                nested_blocks.pop(block_name, None)
                consume_block(Scanner(existing_block.content, d), buf, nested_blocks, **opts)
            elif tag["block"]:
                blocks_to_close += 1
            elif tag["endblock"]:
                blocks_to_close -= 1
            has_super = has_super or tag["super_tag"]
        else:
            ch = scanner.read_char()
            if buf is not None:
                buf.append(ch)
    return has_super


def rewrite_super(block: str, parent_content: str, **opts: Any) -> str:
    d = make_delimiters(**opts)
    super_tag = f"{re.escape(variable_open(d))}\\s*block\\.super\\s*{re.escape(variable_close(d))}"
    return re.sub(super_tag, parent_content, block)


def read_block(scanner: Scanner, block_tag: str, blocks: Blocks, **opts: Any) -> Blocks:
    block_name = _classify_tag(block_tag, scanner.delimiters)["block_name"] or ""
    existing = blocks.get(block_name)
    if existing and existing.super:
        child_content = existing.content
        parent = Buffer()
        has_super = consume_block(scanner, parent, blocks, True, **opts)
        updated = dict(blocks)
        updated[block_name] = BlockInfo(has_super, rewrite_super(child_content, str(parent), **opts))
        return updated
    if existing:
        consume_block(scanner, **opts)
        return blocks
    buf = Buffer()
    buf.append(block_tag)
    has_super = consume_block(scanner, buf, blocks, **opts)
    updated = dict(blocks)
    updated[block_name] = BlockInfo(has_super, str(buf))
    return updated


def process_block(scanner: Scanner, buf: Buffer, block_tag: str, blocks: Blocks, **opts: Any) -> None:
    block_name = _classify_tag(block_tag, scanner.delimiters)["block_name"] or ""
    child = blocks.get(block_name)
    if child is not None:
        parent = Buffer()
        consume_block(scanner, parent, blocks, True, **opts)
        buf.append(rewrite_super(child.content, str(parent), **opts))
    else:
        buf.append(block_tag)
        consume_block(scanner, buf, blocks, **opts)


def wrap_in_expression_tag(s: str, **opts: Any) -> str:
    d = make_delimiters(**opts)
    return f"{expression_open(d)}{s}{expression_close(d)}"


def wrap_in_variable_tag(s: str, **opts: Any) -> str:
    d = make_delimiters(**opts)
    return f"{variable_open(d)}{s}{variable_close(d)}"


def trim_variable_tag(s: str, **opts: Any) -> str:
    return tag_inner_content(s, make_delimiters(**opts))


def trim_expression_tag(s: str, **opts: Any) -> str:
    return tag_inner_content(s, make_delimiters(**opts))


def _unparse_defaults(defaults: Defaults) -> str | None:
    if not defaults:
        return None
    return " ".join(f'{k}="{v}"' for k, v in defaults.items()).strip()


def to_expression_string(tag_name: str, args: list[str], defaults: Defaults, **opts: Any) -> str:
    defaults_s = _unparse_defaults(defaults) if tag_name == "include" else None
    joined = f"{tag_name}{' ' + ' '.join(args) if args else ''}{' with ' + defaults_s if defaults_s else ''}"
    return wrap_in_expression_tag(joined, **opts)


def add_default(identifier: str, default: str) -> str:
    return f'{identifier}|default:"{default}"'


def try_add_default(identifier: str, defaults: Defaults) -> str:
    return add_default(identifier, defaults[identifier]) if defaults and identifier in defaults else identifier


def add_defaults_to_variable_tag(tag_str: str, defaults: Defaults, **opts: Any) -> str:
    return wrap_in_variable_tag(try_add_default(trim_variable_tag(tag_str, **opts), defaults), **opts)


def add_defaults_to_expression_tag(tag_str: str, defaults: Defaults, **opts: Any) -> str:
    info = _tag_info(tag_str, make_delimiters(**opts))
    if getattr(info, "tag_type", None) != "expr":
        return tag_str
    args = [try_add_default(arg, defaults) for arg in getattr(info, "args", [])]
    return to_expression_string(getattr(info, "tag_name"), args, defaults, **opts)


def preprocess_template_string(template: str, *, blocks: Blocks | None = None, defaults: Defaults = None, **opts: Any) -> str:
    return _read_template(template, True, blocks or {}, defaults, opts)


def preprocess_template_file(template: str, *, blocks: Blocks | None = None, defaults: Defaults = None, **opts: Any) -> str:
    return _read_template(template, False, blocks or {}, defaults, opts)


def preprocess_template(template: str, **opts: Any) -> str:
    return preprocess_template_string(template, **opts) if "\n" in str(template) else preprocess_template_file(template, **opts)


def _read_template(template: str, string_mode: bool, blocks: Blocks, defaults: Defaults, opts: dict[str, Any]) -> str:
    d = make_delimiters(**opts)
    source = str(template) if string_mode else _read_template_file(str(template), opts)
    scanner = Scanner(source, d)
    buf = Buffer()
    parent: str | None = None
    current_blocks = blocks
    while not scanner.eof():
        if _starts_tag(scanner):
            tag_str = scanner.read_tag_content()
            tag = _classify_tag(tag_str, d)
            if defaults and getattr(tag["info"], "tag_type", None) == "filter":
                buf.append(add_defaults_to_variable_tag(tag_str, defaults, **opts))
            elif defaults and getattr(tag["info"], "tag_type", None) == "expr" and not tag["include"]:
                buf.append(add_defaults_to_expression_tag(tag_str, defaults, **opts))
            elif defaults and tag["include"]:
                buf.append(_process_includes(add_defaults_to_expression_tag(tag_str, defaults, **opts), current_blocks, opts))
            elif tag["include"]:
                buf.append(_process_includes(tag_str, current_blocks, opts))
            elif tag["extends"]:
                parent = get_parent(tag_str, **opts)
            elif parent and tag["block"]:
                current_blocks = read_block(scanner, tag_str, current_blocks, **opts)
            elif tag["block"]:
                process_block(scanner, buf, tag_str, current_blocks, **opts)
            elif parent is None:
                buf.append(tag_str)
        else:
            ch = scanner.read_char()
            if parent is None:
                buf.append(ch)
    return _read_template(parent, False, current_blocks, defaults, opts) if parent else str(buf)


def _read_template_file(template: str, opts: dict[str, Any]) -> str:
    validate(template, **opts)
    content, _resource = read_resource(template, **opts)
    return content
