from __future__ import annotations

from collections.abc import Callable, Mapping, MutableMapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, TypeAlias

Context: TypeAlias = Mapping[Any, Any] | MutableMapping[Any, Any]
AccessorKey: TypeAlias = str | int
AccessorPath: TypeAlias = list[AccessorKey]
FilterFunction: TypeAlias = Callable[..., Any]


@dataclass(frozen=True)
class Delimiters:
    tag_open: str = "{"
    tag_close: str = "}"
    filter_open: str = "{"
    filter_close: str = "}"
    tag_second: str = "%"
    short_comment_second: str = "#"


@dataclass(frozen=True)
class FilterTagInfo:
    tag_type: str
    tag_value: str


@dataclass(frozen=True)
class ExprTagInfo:
    tag_type: str
    tag_name: str
    args: list[str]


TagInfo: TypeAlias = FilterTagInfo | ExprTagInfo


class TemplateNode(Protocol):
    def render_node(self, context: Context) -> Any: ...


@dataclass
class TagContentBlock:
    content: list[TemplateNode]
    args: list[str] | None = None


TagContentMap: TypeAlias = dict[str, TagContentBlock | list[TagContentBlock]]
RenderFunction: TypeAlias = Callable[[list[TemplateNode], Context], str]
TagContentFunction: TypeAlias = Callable[..., TagContentMap]
ExprTagRuntime: TypeAlias = Callable[[Context], Any]
ExprTagHandler: TypeAlias = Callable[[list[str], TagContentFunction, RenderFunction, Any], ExprTagRuntime]
CustomTagUserHandler: TypeAlias = Callable[[list[str], Context, dict[str, Any] | None], Any]
