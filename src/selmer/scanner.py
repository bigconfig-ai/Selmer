from __future__ import annotations

import re
from dataclasses import dataclass

from .types import Delimiters, ExprTagInfo, FilterTagInfo, TagInfo
from .util import expression_close, expression_open, short_comment_close, short_comment_open, variable_close, variable_open


@dataclass
class Scanner:
    input: str
    delimiters: Delimiters
    tag_collector: list[TagInfo] | None = None
    index: int = 0

    def eof(self) -> bool:
        return self.index >= len(self.input)

    def read_char(self) -> str | None:
        if self.eof():
            return None
        ch = self.input[self.index]
        self.index += 1
        return ch

    def peek(self, offset: int = 0) -> str | None:
        pos = self.index + offset
        return self.input[pos] if 0 <= pos < len(self.input) else None

    def startswith(self, value: str) -> bool:
        return self.input.startswith(value, self.index)

    def starts_tag(self) -> bool:
        return self.startswith(variable_open(self.delimiters)) or self.startswith(expression_open(self.delimiters))

    def starts_short_comment(self) -> bool:
        return self.startswith(short_comment_open(self.delimiters))

    def skip_short_comment(self) -> None:
        close = short_comment_close(self.delimiters)
        start = self.index + len(short_comment_open(self.delimiters))
        end = self.input.find(close, start)
        if end < 0:
            raise ValueError("short-form comment tag was not closed")
        self.index = end + len(close)

    def read_tag_content(self) -> str:
        start = self.index
        variable = self.startswith(variable_open(self.delimiters))
        expr = self.startswith(expression_open(self.delimiters))
        if not variable and not expr:
            raise ValueError(f"Expected opening delimiter at {self.index}")
        close = variable_close(self.delimiters) if variable else expression_close(self.delimiters)
        end = self.input.find(close, self.index + 2)
        if end < 0:
            raise EOFError(f"Expected closing delimiter: {self.input[start:]}")
        self.index = end + len(close)
        return self.input[start:self.index]

    def read_tag_info(self) -> TagInfo:
        start = self.index
        variable = self.startswith(variable_open(self.delimiters))
        expr = self.startswith(expression_open(self.delimiters))
        if not variable and not expr:
            raise ValueError(f"Expected opening delimiter at {self.index}")
        open_delim = variable_open(self.delimiters) if variable else expression_open(self.delimiters)
        close_delim = variable_close(self.delimiters) if variable else expression_close(self.delimiters)
        content_start = self.index + len(open_delim)
        end = self.input.find(close_delim, content_start)
        if end < 0:
            raise EOFError(f"Expected closing delimiter: {self.input[start:]}")
        raw = self.input[content_start:end]
        self.index = end + len(close_delim)
        check_tag_args(raw)
        if variable:
            tag: TagInfo = FilterTagInfo("filter", raw.strip())
        else:
            parts = [part.strip() for part in re.findall(r'(?:[^\s"]|"[^"]*")+', raw) if part.strip()]
            tag = ExprTagInfo("expr", parts[0] if parts else "", parts[1:])
        if self.tag_collector is not None:
            self.tag_collector.append(tag)
        return tag


def check_tag_args(args: str) -> str:
    if args.count('"') % 2 != 0:
        raise ValueError(f"malformed tag arguments in {args}")
    return args


def read_tag_info_from_string(tag_string: str, delimiters: Delimiters) -> TagInfo:
    return Scanner(tag_string, delimiters).read_tag_info()


def tag_inner_content(tag_string: str, delimiters: Delimiters) -> str:
    if tag_string.startswith(variable_open(delimiters)):
        return tag_string[len(variable_open(delimiters)) : -len(variable_close(delimiters))].strip()
    if tag_string.startswith(expression_open(delimiters)):
        return tag_string[len(expression_open(delimiters)) : -len(expression_close(delimiters))].strip()
    return tag_string
