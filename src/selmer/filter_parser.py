from __future__ import annotations

from typing import Any, Callable

from .safe import SAFE_CONTEXT_KEY, SafeValue, is_safe_value, safe, unwrap_safe
from .types import Context
from .util import (
    clj_str,
    get_accessor,
    get_in,
    is_escaping_variables,
    parse_accessor,
    should_filter_missing_values,
)


def escape_html_star(s: str) -> str:
    if not is_escaping_variables():
        return s
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


escape_html_bang = escape_html_star


def strip_doublequotes(s: str) -> str:
    return s[1:-1] if len(s) > 1 and s.startswith('"') and s.endswith('"') else s


def escape_html(x: Any) -> Any:
    unwrapped = unwrap_safe(x)
    if unwrapped is not x:
        return unwrapped
    return escape_html_star(clj_str(x))


def fix_filter_args(args: list[str]) -> list[str]:
    return [strip_doublequotes(arg) for arg in args]


def lookup_args(context: Context) -> Callable[[str], Any]:
    def lookup(arg: str) -> Any:
        if len(arg) > 1 and arg.startswith("@"):
            value = get_in(context, parse_accessor(arg[1:]))
            return arg if value is None else value
        return arg

    return lookup


def _split_respecting_quotes(s: str, delimiter: str) -> list[str]:
    result: list[str] = []
    buf = ""
    quoted = False
    escaped = False
    for ch in s:
        if escaped:
            buf += ch
            escaped = False
            continue
        if ch == "\\":
            buf += ch
            escaped = True
            continue
        if ch == '"':
            quoted = not quoted
            buf += ch
            continue
        if not quoted and ch == delimiter:
            result.append(buf)
            buf = ""
        else:
            buf += ch
    result.append(buf)
    return result


def filter_str_to_fn(s: str) -> Callable[[Any, Context], Any]:
    from .filters import get_filter

    parts = _split_respecting_quotes(s, ":")
    filter_name = parts[0].strip() if parts else ""
    args = fix_filter_args(parts[1:])
    filt = get_filter(filter_name)
    if filt is None:
        raise ValueError(f"No filter defined with the name '{filter_name}'")

    def run(x: Any, context: Context) -> Any:
        return filt(x, *[lookup_args(context)(arg) for arg in args])

    return run


def literal(value: str) -> bool:
    return (value.startswith('"') and value.endswith('"')) or value.isdigit()


literal_q = literal


def parse_literal(value: str) -> str:
    return value[1:-1] if value.startswith('"') else value


def split_value(s: str) -> list[str]:
    return [part.strip() for part in _split_respecting_quotes(s, "|") if part.strip()]


def _apply_filters(
    value: Any,
    body: str,
    filter_strings: list[str],
    compiled_filters: list[Callable[[Any, Context], Any]],
    context: Context,
) -> Any:
    acc = value
    for filter_string, filt in zip(filter_strings, compiled_filters, strict=False):
        try:
            acc = filt(acc, context)
        except Exception as exc:  # noqa: BLE001 - enrich template errors
            raise RuntimeError(
                f"On filter body '{body}' and filter '{filter_string}' this error occurred:{exc}"
            ) from exc
    return acc


def _finalize_filter_value(x: Any, context: Context, escape: bool) -> Any:
    unwrapped = unwrap_safe(x)
    if unwrapped is not x:
        return unwrapped
    if get_accessor(context, SAFE_CONTEXT_KEY):
        return unwrapped
    return escape_html(unwrapped) if escape else unwrapped


def get_accessor_value(m: Any, k: str | int) -> Any:
    return get_accessor(m, k)


def compile_filter_body(s: str, escape: bool = True) -> Callable[[Context], Any]:
    parts = split_value(s)
    val = parts[0] if parts else ""
    filter_strings = parts[1:]
    accessor = parse_accessor(val)
    compiled_filters = [filter_str_to_fn(filter_string) for filter_string in filter_strings]

    if literal(val):
        def run_literal(context: Context) -> Any:
            x = _apply_filters(parse_literal(val), s, filter_strings, compiled_filters, context)
            return _finalize_filter_value(x, context, escape)

        return run_literal

    def run(context: Context) -> Any:
        value = context
        for key in accessor:
            value = get_accessor(value, key)
        if value is not None or (should_filter_missing_values() and compiled_filters):
            x = _apply_filters(value, s, filter_strings, compiled_filters, context)
            return _finalize_filter_value(x, context, escape)
        return None

    return run
