from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from .types import Context


class FunctionHandler(Protocol):
    meta: dict[str, Any]

    def __call__(self, context: Context) -> Any: ...


@dataclass
class FunctionNode:
    handler: Callable[[Context], Any]

    def render_node(self, context: Context) -> Any:
        return self.handler(context)

    @property
    def meta(self) -> dict[str, Any] | None:
        return getattr(self.handler, "meta", None)


@dataclass
class TextNode:
    text: str

    def render_node(self, context: Context) -> str:
        return str(self.text)

    def __str__(self) -> str:
        return str(self.text)
