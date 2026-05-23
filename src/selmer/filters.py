from __future__ import annotations

import json
import math
import random
import re
from datetime import date, datetime, time
from typing import Any, Callable
from urllib.parse import quote_plus

from .safe import safe
from .types import FilterFunction
from .util import clj_str, count, get_accessor, hex_digest, is_empty, seq

filters: dict[str, FilterFunction] = {}


def parse_number(value: Any) -> int | float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    s = str(value)
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError as exc:
            raise ValueError(f"Expected '{value}' to be a number.") from exc


def _expect_seqable(x: Any, msg: str | None = None) -> None:
    if x is None:
        return
    try:
        seq(x)
    except Exception as exc:  # noqa: BLE001
        raise TypeError(msg or f"Expected '{x}' to be a collection of some sort.") from exc


def _expect_number(x: Any, msg: str | None = None) -> None:
    if not isinstance(x, (int, float)) or isinstance(x, bool):
        raise TypeError(msg or f"Expected '{'nil' if x is None else x}' to be a number.")


def _is_numeric_string(value: Any) -> bool:
    return bool(re.fullmatch(r"-?[0-9]*\.?[0-9]+", str(value)))


def _format_number(value: int | float) -> int | float | str:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, float):
        return (f"{value:.12f}").rstrip("0").rstrip(".")
    return value


def _range(end: Any, start: Any = None, step: Any = None) -> list[int]:
    e = int(parse_number(end))
    s = 0 if start is None else int(parse_number(start))
    st = 1 if step is None else int(parse_number(step))
    if st == 0:
        raise ValueError("step must not be 0")
    return list(range(s, e, st))


def _capitalize(s: str) -> str:
    return s[:1].upper() + s[1:].lower() if s else s


def _number_format(n: float, fmt: str, locale: str | None = None) -> str:
    match = re.fullmatch(r"%\.(\d+)f", fmt)
    if match:
        out = f"{n:.{int(match.group(1))}f}"
        return out.replace(".", ",") if locale and locale.startswith("de") else out
    try:
        return fmt % n
    except Exception:
        return format(n, fmt)


def _format_date(d: Any, fmt: str, locale: str | None = None) -> str | None:
    if d is None:
        return None
    wrap_quotes = fmt.startswith('"') and fmt.endswith('"')
    if wrap_quotes:
        fmt = fmt[1:-1]
    if isinstance(d, datetime):
        dt = d
    elif isinstance(d, date):
        dt = datetime.combine(d, time())
    elif isinstance(d, (int, float)):
        dt = datetime.fromtimestamp(d)
    else:
        try:
            dt = datetime.fromisoformat(str(d))
        except ValueError as exc:
            raise ValueError(f"{d} is not a valid date format.") from exc

    aliases: dict[str, Callable[[], str]] = {
        "shortTime": lambda: dt.strftime("%H:%M"),
        "shortDate": lambda: f"{dt.year}/{dt.month}/{dt.day}" if locale and locale.startswith("zh") else dt.strftime("%Y-%m-%d"),
        "shortDateTime": lambda: f"{aliases['shortDate']()} {aliases['shortTime']()}",
        "mediumDate": lambda: aliases["shortDate"](),
        "mediumTime": lambda: dt.strftime("%H:%M:%S"),
        "mediumDateTime": lambda: f"{aliases['shortDate']()} {aliases['mediumTime']()}",
        "longDate": lambda: f"{dt.year}年{dt.month}月{dt.day}日" if locale and locale.startswith("zh") else dt.strftime("%Y %b %-d"),
        "longTime": lambda: aliases["mediumTime"](),
        "longDateTime": lambda: f"{aliases['longDate']()} {aliases['mediumTime']()}",
        "fullDate": lambda: dt.strftime("%A, %B %-d, %Y"),
        "fullTime": lambda: dt.strftime("%H:%M:%S"),
        "fullDateTime": lambda: dt.strftime("%A, %B %-d, %Y %H:%M:%S"),
    }
    if fmt in aliases:
        out = aliases[fmt]()
    else:
        py_fmt = (
            fmt.replace("yyyy", "%Y")
            .replace("MMMM", "%B")
            .replace("MMM", "%b")
            .replace("MM", "%m")
            .replace("dd", "%d")
            .replace("HH", "%H")
            .replace("mm", "%M")
            .replace("ss", "%S")
        )
        out = dt.strftime(py_fmt)
    return f'"{out}"' if wrap_quotes else out


def _get_filter_value(value: Any, key: Any, default: Any = None) -> Any:
    k = str(key)[1:] if isinstance(key, str) and key.startswith(":") else key
    result = get_accessor(value, k)
    return default if result is None else result


def _compare_values(a: Any, b: Any) -> int:
    if a == b:
        return 0
    if a is None:
        return -1
    if b is None:
        return 1
    return -1 if a < b else 1


def _linebreaks(s: Any) -> str:
    br = str(s).replace("\n", "<br />")
    p = br.replace("<br /><br />", "</p><p>").removesuffix("<p>")
    return f"<p>{p}" if p.endswith("</p>") else f"<p>{p}</p>"


def _register_builtins() -> None:
    builtins: dict[str, FilterFunction] = {
        "str": lambda x: clj_str(x),
        "subs": lambda s, start, end, *rest: (lambda result: result + "".join(map(str, rest)) if rest and len(str(s)) != len(result) else result)(str(s)[int(parse_number(start)):int(parse_number(end))]),
        "abbr-left": lambda s: {**(s if isinstance(s, dict) else {"s": s}), "abbr_position": "left"},
        "abbr-middle": lambda s: {**(s if isinstance(s, dict) else {"s": s}), "abbr_position": "middle"},
        "abbr-right": lambda s: {**(s if isinstance(s, dict) else {"s": s}), "abbr_position": "right"},
        "abbr-ellipsis": lambda s, ellipsis: {**(s if isinstance(s, dict) else {"s": s}), "abbr_ellipsis": str(ellipsis)},
        "addslashes": lambda s: re.sub(r"([\"'])", r"\\\1", str(s)),
        "center": lambda s, w: str(s).center(int(parse_number(str(w).strip()))),
        "number-format": lambda n, fmt, locale=None: (_expect_number(n), _number_format(float(n), str(fmt), str(locale) if locale else None))[1],
        "currency-format": lambda n, locale=None, country=None: (_expect_number(n), ("€" if locale and str(locale).startswith("de") else "$") + f"{float(n):.2f}")[1],
        "date": lambda d, fmt, locale=None: _format_date(d, str(fmt), str(locale) if locale else None),
        "default": lambda x, default: default if x is None or x is False else x,
        "default-if-empty": lambda coll, default: default if coll is None or is_empty(coll) else coll,
        "double-format": lambda n, places=None: (_expect_number(n), f"{float(n):.{int(places) if places is not None else 1}f}")[1],
        "first": lambda coll: (_expect_seqable(coll), seq(coll)[0] if seq(coll) else None)[1],
        "take": lambda coll, n: (_expect_seqable(coll), seq(coll)[: int(parse_number(n))])[1],
        "drop": lambda coll, n: (_expect_seqable(coll), seq(coll)[int(parse_number(n)):])[1],
        "drop-last": lambda coll, n: (_expect_seqable(coll), seq(coll)[: max(0, len(seq(coll)) - int(parse_number(n)))])[1],
        "get-digit": lambda n, i: _get_digit(n, i),
        "hash": lambda s, algorithm: hex_digest(str(algorithm), str(s)),
        "join": lambda coll, sep="": (_expect_seqable(coll), str(sep).join(clj_str(x) for x in seq(coll)))[1],
        "empty?": lambda x: is_empty(x),
        "not-empty": lambda x: None if is_empty(x) else x,
        "json": lambda x: json.dumps(None if x is None else x, separators=(",", ":")),
        "last": lambda coll: (_expect_seqable(coll), seq(coll)[-1] if seq(coll) else None)[1],
        "length": lambda coll: count(coll),
        "count": lambda coll: count(coll),
        "length-is": lambda coll, n: safe(int(parse_number(n)) == count(coll)),
        "count-is": lambda coll, n: safe(int(parse_number(n)) == count(coll)),
        "linebreaks": _linebreaks,
        "linebreaks-br": lambda s: str(s).replace("\n", "<br />"),
        "linenumbers": lambda s: "\n".join(f"{i + 1}. {line}" for i, line in enumerate(str(s).split("\n"))),
        "rand-nth": lambda coll: (_expect_seqable(coll), random.choice(seq(coll)))[1],
        "range": lambda end, start=None, step=None: _range(end, start, step),
        "remove": lambda s, chars: "".join(ch for ch in str(s) if ch not in set(str(chars))),
        "pluralize": _pluralize,
        "safe": lambda s: safe(s),
        "urlescape": lambda s: quote_plus(str(s)),
        "lower": lambda s: str(s).lower(),
        "upper": lambda s: str(s).upper(),
        "capitalize": lambda s: _capitalize(str(s)),
        "title": lambda s: " ".join(_capitalize(part) for part in str(s).split(" ")),
        "sort": lambda coll: (_expect_seqable(coll), sorted(seq(coll)))[1],
        "sort-by": lambda coll, k: (_expect_seqable(coll), sorted(seq(coll), key=lambda item: _get_filter_value(item, k)))[1],
        "sort-by-reversed": lambda coll, k: (_expect_seqable(coll), sorted(seq(coll), key=lambda item: _get_filter_value(item, k), reverse=True))[1],
        "sort-reversed": lambda coll: (_expect_seqable(coll), sorted(seq(coll), reverse=True))[1],
        "between?": lambda val, x, y: safe(_between(val, x, y)),
        "replace": lambda s, search, replacement: str(s).replace(str(search), str(replacement)),
        "remove-tags": _remove_tags,
        "email": _email,
        "phone": _phone,
        "name": lambda x: str(x).lstrip(":").rsplit("/", 1)[-1],
        "get": lambda x, key, default=None: _get_filter_value(x, key, default),
        "add": _add,
        "multiply": lambda x, y: _format_number(parse_number(x) * parse_number(y)),
        "divide": _divide,
        "round": lambda x: math.floor(parse_number(x) + 0.5),
        "abbreviate": _abbreviate,
    }
    filters.update(builtins)


def _get_digit(n: Any, i: Any) -> Any:
    chars = list(str(n))
    idx = len(chars) - int(parse_number(i))
    if idx < 0 or idx >= len(chars):
        return n
    return chars[idx - 1] if chars[idx] == "." else chars[idx]


def _add(x: Any, y: Any, *rest: Any) -> Any:
    args = [str(x), y, *rest]
    if all(_is_numeric_string(arg) for arg in args):
        return _format_number(sum(parse_number(arg) for arg in args))
    return "".join(map(str, args))


def _divide(x: Any, y: Any) -> Any:
    divisor = parse_number(y)
    if divisor == 0:
        raise ZeroDivisionError("division by zero")
    return _format_number(parse_number(x) / divisor)


def _between(val: Any, x: Any, y: Any) -> bool:
    v, a, b = parse_number(val), parse_number(x), parse_number(y)
    return a <= v <= b if a <= b else b <= v <= a


def _pluralize(n_or_coll: Any, *opts: Any) -> Any:
    n = n_or_coll if isinstance(n_or_coll, (int, float)) and not isinstance(n_or_coll, bool) else count(n_or_coll)
    plural = "s" if len(opts) == 0 else opts[0] if len(opts) == 1 else opts[1]
    singular = opts[0] if len(opts) == 2 else ""
    return singular if n == 1 else plural


def _remove_tags(s: Any, *tags: Any) -> str:
    if not tags:
        return str(s)
    group = "(" + "|".join(re.escape(str(tag)) for tag in tags) + ")"
    result = re.sub(rf"(?i)<{group}(/?>|(\s+[^>]*>))", "", str(s))
    return re.sub(rf"(?i)</{group}>", "", result)


def _email(email: Any, validate: Any = None) -> Any:
    address = str(email)
    if validate == "false" or re.fullmatch(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}", address):
        return safe(f"<a href='mailto:{address}'>{address}</a>")
    raise ValueError(f"{address} does not appear to be a valid email address")


def _phone(phone: Any, arg1: Any = None, arg2: Any = None) -> Any:
    national_prefix = None
    validate = True
    if arg1 is not None and arg2 is not None:
        national_prefix = arg1
        validate = False if arg2 == "false" else True if arg2 == "true" else bool(arg2)
    elif arg1 == "false":
        validate = False
    elif arg1 == "true" or arg1 is None:
        validate = True
    else:
        national_prefix = arg1
    original = str(phone)
    number = re.sub(r"^0", f"+{national_prefix}-", original) if national_prefix else original
    if not validate or re.fullmatch(r"[0-9 +-]*", number):
        return safe(f"<a href='tel:{re.sub(r'\s+', '-', number)}'>{original}</a>")
    raise ValueError(f"{number} does not appear to be a valid phone number")


def _abbreviate(input_value: Any, max_width_arg: Any, abbreviated_width_arg: Any = None) -> str:
    obj = input_value if isinstance(input_value, dict) and "s" in input_value else {"s": input_value}
    max_width = int(parse_number(max_width_arg))
    abbreviated_width = max_width if abbreviated_width_arg is None else int(parse_number(abbreviated_width_arg))
    ellipsis = str(obj.get("abbr_ellipsis", "..."))
    position = str(obj.get("abbr_position", "right"))
    effective_width = abbreviated_width - len(ellipsis)
    s = str(obj.get("s"))
    if max_width < abbreviated_width:
        raise ValueError(f"Maximum width {max_width} can't be shorter than abbreviated width {abbreviated_width}")
    if abbreviated_width < len(ellipsis):
        raise ValueError(f"Length {len(ellipsis)} of ellipsis '{ellipsis}' can't be bigger than abbreviated width {abbreviated_width}")
    if len(s) <= max_width:
        return s
    if position == "left":
        return ellipsis + s[-effective_width:]
    if position == "middle":
        half = effective_width // 2
        return s[:half] + ellipsis + s[-half:]
    return s[:effective_width] + ellipsis


_register_builtins()


def get_filter(name: str) -> FilterFunction | None:
    return filters.get(name[1:] if name.startswith(":") else name)


def call_filter(name: str, *args: Any) -> Any:
    filt = get_filter(name)
    if filt is None:
        raise ValueError(f"No filter defined with the name '{name}'")
    return filt(*args)


def add_filter(name: str, fn: FilterFunction) -> None:
    filters[name[1:] if name.startswith(":") else name] = fn


add_filter_bang = add_filter


def remove_filter(name: str) -> None:
    filters.pop(name[1:] if name.startswith(":") else name, None)


remove_filter_bang = remove_filter
