from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SAFE_CONTEXT_KEY = "__selmer_safe_filter__"


@dataclass(frozen=True)
class SafeValue:
    value: Any


def safe(value: Any) -> SafeValue:
    return SafeValue(value)


def is_safe_value(value: Any) -> bool:
    return isinstance(value, SafeValue) or (
        isinstance(value, (list, tuple)) and len(value) >= 2 and value[0] in {":safe", "safe"}
    )


def unwrap_safe(value: Any) -> Any:
    if isinstance(value, SafeValue):
        return value.value
    if isinstance(value, (list, tuple)) and len(value) >= 2 and value[0] in {":safe", "safe"}:
        return value[1]
    return value
