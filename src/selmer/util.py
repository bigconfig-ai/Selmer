from __future__ import annotations

import hashlib
import os
import re
import sys
from collections.abc import Iterable, Mapping, MutableMapping
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse, unquote

from .types import AccessorKey, AccessorPath, Context, Delimiters, TagInfo

DEFAULT_DELIMITERS = Delimiters()


def make_delimiters(**opts: Any) -> Delimiters:
    return Delimiters(
        tag_open=opts.get("tag_open", opts.get("tagOpen", DEFAULT_DELIMITERS.tag_open)),
        tag_close=opts.get("tag_close", opts.get("tagClose", DEFAULT_DELIMITERS.tag_close)),
        filter_open=opts.get("filter_open", opts.get("filterOpen", DEFAULT_DELIMITERS.filter_open)),
        filter_close=opts.get("filter_close", opts.get("filterClose", DEFAULT_DELIMITERS.filter_close)),
        tag_second=opts.get("tag_second", opts.get("tagSecond", DEFAULT_DELIMITERS.tag_second)),
        short_comment_second=opts.get(
            "short_comment_second", opts.get("shortCommentSecond", DEFAULT_DELIMITERS.short_comment_second)
        ),
    )


def variable_open(d: Delimiters) -> str:
    return d.tag_open + d.filter_open


def variable_close(d: Delimiters) -> str:
    return d.filter_close + d.tag_close


def expression_open(d: Delimiters) -> str:
    return d.tag_open + d.tag_second


def expression_close(d: Delimiters) -> str:
    return d.tag_second + d.tag_close


def short_comment_open(d: Delimiters) -> str:
    return d.tag_open + d.short_comment_second


def short_comment_close(d: Delimiters) -> str:
    return d.short_comment_second + d.tag_close


_custom_resource_path: str | None = None
_resource_loader: Callable[[str], str | None] | None = None
_escape_variables = True
_warn_on_deprecated_keys = True
_warned_keys: set[str] = set()

MissingValueFormatter = Callable[[Any, Context], Any]


def default_missing_value_formatter(tag: Any = None, context: Context | None = None) -> str:
    return ""


_missing_value_formatter: MissingValueFormatter = default_missing_value_formatter
_filter_missing_values = True


def get_custom_resource_path() -> str | None:
    return _custom_resource_path


def append_slash(s: str | None) -> str | None:
    if s is None or s.endswith("/"):
        return s
    return s + "/"


def make_resource_path(path: str | os.PathLike[str] | None) -> str | None:
    if path is None:
        return None
    p = str(path)
    if p.startswith("file:"):
        parsed = urlparse(p)
        return append_slash(unquote(parsed.path))
    return append_slash(p)


def set_custom_resource_path(path: str | os.PathLike[str] | None) -> None:
    global _custom_resource_path
    _custom_resource_path = make_resource_path(path)


set_custom_resource_path_bang = set_custom_resource_path


def set_resource_path(path: str | os.PathLike[str] | None) -> None:
    set_custom_resource_path(path)


set_resource_path_bang = set_resource_path


def set_resource_loader(loader: Callable[[str], str | None] | None) -> None:
    global _resource_loader
    _resource_loader = loader


def get_resource_loader() -> Callable[[str], str | None] | None:
    return _resource_loader


def turn_off_escaping() -> None:
    global _escape_variables
    _escape_variables = False


turn_off_escaping_bang = turn_off_escaping


def turn_on_escaping() -> None:
    global _escape_variables
    _escape_variables = True


turn_on_escaping_bang = turn_on_escaping


def is_escaping_variables() -> bool:
    return _escape_variables


def with_escaping(fn: Callable[[], Any]) -> Any:
    global _escape_variables
    previous = _escape_variables
    _escape_variables = True
    try:
        return fn()
    finally:
        _escape_variables = previous


def without_escaping(fn: Callable[[], Any]) -> Any:
    global _escape_variables
    previous = _escape_variables
    _escape_variables = False
    try:
        return fn()
    finally:
        _escape_variables = previous


def get_missing_value_formatter() -> MissingValueFormatter:
    return _missing_value_formatter


def should_filter_missing_values() -> bool:
    return _filter_missing_values


def set_missing_value_formatter(formatter: MissingValueFormatter, *, filter_missing_values: bool = False) -> None:
    global _missing_value_formatter, _filter_missing_values
    _missing_value_formatter = formatter
    _filter_missing_values = filter_missing_values


set_missing_value_formatter_bang = set_missing_value_formatter


def reset_missing_value_formatter() -> None:
    global _missing_value_formatter, _filter_missing_values
    _missing_value_formatter = default_missing_value_formatter
    _filter_missing_values = True


def set_warn_on_deprecated_keys(value: bool) -> None:
    global _warn_on_deprecated_keys
    _warn_on_deprecated_keys = value


def reset_deprecated_key_warnings() -> None:
    _warned_keys.clear()


_deprecation_warning_handler: Callable[[str], None] = lambda msg: print(f"DEPRECATION WARNING: {msg}", file=sys.stderr)


def set_deprecation_warning_handler(handler: Callable[[str], None]) -> None:
    global _deprecation_warning_handler
    _deprecation_warning_handler = handler


def deprecated_key_lookup(context: Context, namespaced_key: str, non_namespaced_key: str) -> Any:
    found, value = get_own(context, namespaced_key)
    if found:
        return value
    found, value = get_own(context, non_namespaced_key)
    if found:
        if _warn_on_deprecated_keys and non_namespaced_key not in _warned_keys:
            _warned_keys.add(non_namespaced_key)
            _deprecation_warning_handler(
                f"Using :{non_namespaced_key} in context is deprecated. Please use :{namespaced_key} instead."
            )
        return value
    return None


class ResolvedResource(dict[str, Any]):
    path: str
    display_path: str
    content: str | None
    last_modified: float


def looks_like_absolute_file_path(path: str) -> bool:
    return os.path.isabs(path) or bool(re.match(r"^[a-zA-Z]:", path))


def _path_candidates(template: str, base: str | None = None) -> list[Path]:
    candidates: list[Path] = []
    if base:
        candidates.append(Path(base) / template)
    if looks_like_absolute_file_path(template):
        candidates.append(Path(template))
    candidates.extend([Path(template).resolve(), Path("test") / template, Path("resources") / template])
    if template.startswith("templates/"):
        candidates.append(Path("test") / template)
    seen: set[str] = set()
    unique: list[Path] = []
    for candidate in candidates:
        key = str(candidate)
        if key not in seen:
            unique.append(candidate)
            seen.add(key)
    return unique


def resource_path(template: str | os.PathLike[str], **opts: Any) -> dict[str, Any] | None:
    template_s = str(template)
    loader = opts.get("resource_loader") or opts.get("resourceLoader") or _resource_loader
    base = make_resource_path(opts.get("custom_resource_path", opts.get("customResourcePath", _custom_resource_path)))
    if loader:
        logical = f"{base}{template_s}" if base else template_s
        content = loader(logical)
        if content is None:
            content = loader(template_s)
        if content is not None:
            return {"path": logical, "display_path": logical, "content": content, "last_modified": -1.0}
    if template_s.startswith("file:"):
        template_s = unquote(urlparse(template_s).path)
    for candidate in _path_candidates(template_s, base):
        if candidate.exists():
            return {
                "path": str(candidate),
                "display_path": str(candidate),
                "content": None,
                "last_modified": candidate.stat().st_mtime,
            }
    return None


def read_resource(template: str | os.PathLike[str], **opts: Any) -> tuple[str, dict[str, Any]]:
    resource = resource_path(template, **opts)
    if not resource:
        raise FileNotFoundError(
            f"resource-path for {template} returned nil, typically means the file doesn't exist in your classpath."
        )
    content = resource.get("content")
    if content is None:
        content = Path(resource["path"]).read_text(encoding="utf-8")
    return str(content), resource


def resource_last_modified(template: str | os.PathLike[str], **opts: Any) -> float:
    resource = resource_path(template, **opts)
    return float(resource["last_modified"]) if resource else -1.0


def check_template_exists(template: str | os.PathLike[str], **opts: Any) -> None:
    if not resource_path(template, **opts):
        raise FileNotFoundError(f'template: "{template}" not found')


def _key_alternatives(key: str) -> list[str]:
    alts = [key]
    if key.startswith(":"):
        alts.append(key[1:])
    else:
        alts.append(f":{key}")
    if "/" in key:
        alts.append(key.rsplit("/", 1)[1])
    return list(dict.fromkeys(alts))


def get_own(context: Any, key: AccessorKey) -> tuple[bool, Any]:
    if context is None:
        return False, None
    if isinstance(context, Mapping):
        keys = [key] if isinstance(key, int) else _key_alternatives(str(key))
        for k in keys:
            if k in context:
                return True, context[k]
        return False, None
    if isinstance(context, (list, tuple)) and isinstance(key, int):
        if 0 <= key < len(context):
            return True, context[key]
        return False, None
    if hasattr(context, str(key)):
        return True, getattr(context, str(key))
    return False, None


def get_accessor(m: Any, k: AccessorKey) -> Any:
    return get_own(m, k)[1]


def get_in(context: Any, path: AccessorPath) -> Any:
    value = context
    for key in path:
        value = get_accessor(value, key)
    return value


def clone_context(context: Context) -> dict[Any, Any]:
    return dict(context)


def assoc_in(context: Context, path: AccessorPath, value: Any) -> dict[Any, Any]:
    if not path:
        return dict(context)
    root = dict(context)
    current = root
    for key in path[:-1]:
        existing = current.get(key)
        if isinstance(existing, Mapping):
            nxt = dict(existing)
        else:
            nxt = {}
        current[key] = nxt
        current = nxt
    current[path[-1]] = value
    return root


def _parse_long_value(s: str) -> int | None:
    return int(s) if re.fullmatch(r"\d+", s) else None


def parse_accessor(accessor: str | None) -> AccessorPath:
    if accessor is None or accessor == "":
        return []
    parts: list[str] = []
    buf = ""
    i = 0
    while i < len(accessor):
        ch = accessor[i]
        if ch == ".":
            if i + 1 < len(accessor) and accessor[i + 1] == ".":
                buf += "."
                i += 2
                continue
            parts.append(buf)
            buf = ""
        else:
            buf += ch
        i += 1
    parts.append(buf)
    result: AccessorPath = []
    for part in parts:
        n = _parse_long_value(part)
        result.append(n if n is not None else (part[1:] if part.startswith(":") else part))
    return result


def split_by_args(s: str) -> list[str]:
    items: list[str] = []
    buf = ""
    open_quote = False
    for ch in s:
        if open_quote and ch == '"':
            value = buf.strip()
            buf = ""
            items.append(value)
            open_quote = False
        elif ch == '"':
            open_quote = True
        elif not open_quote and ch == "=":
            item = buf.strip()
            buf = ""
            items.append(item)
        else:
            buf += ch
    return [x for x in items if x]


def ffind(fn: Callable[[Any], bool], coll: Iterable[Any]) -> Any:
    for item in coll:
        if fn(item):
            return item
    return None


def hex_digest(algo: str, s: str) -> str:
    mapping = {"md5": "md5", "sha": "sha1", "sha256": "sha256", "sha384": "sha384", "sha512": "sha512"}
    if algo not in mapping:
        raise ValueError(f"'{algo}' is not a valid hash algorithm.")
    return hashlib.new(mapping[algo], s.encode()).hexdigest()


def is_nil(value: Any) -> bool:
    return value is None


def seq(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        return list(value)
    if isinstance(value, Mapping):
        return list(value.items())
    if isinstance(value, set):
        return list(value)
    if isinstance(value, Iterable):
        return list(value)
    raise TypeError(f"Expected '{value}' to be a collection of some sort.")


def count(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (str, list, tuple, Mapping, set)):
        return len(value)
    if isinstance(value, Iterable):
        return len(list(value))
    raise TypeError(f"Expected '{value}' to be a collection of some sort.")


def is_empty(value: Any) -> bool:
    return count(value) == 0


def not_empty(value: Any) -> Any:
    return None if is_empty(value) else value


def clj_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    if isinstance(value, list):
        return "[" + " ".join(pr_str(v) for v in value) + "]"
    if isinstance(value, tuple):
        return "(" + " ".join(pr_str(v) for v in value) + ")"
    if isinstance(value, set):
        return "#{" + " ".join(pr_str(v) for v in value) + "}"
    if isinstance(value, Mapping):
        return "{" + ", ".join(f"{_pr_str_key(k)} {pr_str(v)}" for k, v in value.items()) + "}"
    return str(value)


def pr_str(value: Any) -> str:
    if isinstance(value, str):
        if value.startswith(":"):
            return value
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return clj_str(value)


def _pr_str_key(key: Any) -> str:
    if isinstance(key, str):
        return key if key.startswith(":") else f":{key}"
    return pr_str(key)
