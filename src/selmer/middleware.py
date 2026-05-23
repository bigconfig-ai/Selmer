from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .parser import render
from .validator import SelmerValidationError


def handle_template_parsing_error(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, SelmerValidationError) and exc.data.get("type") == "selmer/validation-error":
        return {
            "status": 500,
            "headers": {"Content-Type": "text/html; charset=utf-8"},
            "body": render(str(exc.data.get("error_template") or exc.data.get("error-template") or "{{error}}"), exc.data),
        }
    raise exc


def wrap_error_page(handler: Callable[[Any], Any]) -> Callable[[Any], Any]:
    def wrapped(request: Any) -> Any:
        try:
            return handler(request)
        except Exception as exc:  # noqa: BLE001
            return handle_template_parsing_error(exc)

    return wrapped
