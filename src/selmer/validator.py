from __future__ import annotations

from importlib import resources
from typing import Any

from .filter_parser import split_value
from .filters import filters
from .scanner import Scanner
from .tags import closing_tags, expr_tags
from .types import ExprTagInfo, FilterTagInfo, TagInfo
from .util import make_delimiters, read_resource

_validate = True


def validate_on() -> None:
    global _validate
    _validate = True


validate_on_bang = validate_on


def validate_off() -> None:
    global _validate
    _validate = False


validate_off_bang = validate_off


class SelmerValidationError(Exception):
    def __init__(self, message: str, data: dict[str, Any]) -> None:
        super().__init__(message)
        self.data = data


def _load_error_template() -> str:
    try:
        return resources.files("selmer.resources").joinpath("selmer-error-template.html").read_text(encoding="utf-8")
    except Exception:
        return "<html><body><h1>Selmer template error</h1><p>{{error}}</p></body></html>"


error_template = _load_error_template()


def format_tag(tag: TagInfo | None) -> str:
    if tag is None:
        return ""
    if tag.tag_type == "expr":
        return f"{{% {tag.tag_name} {' '.join(tag.args)} %}}"
    return f"{{{{{tag.tag_value}}}}}"


def validation_error(error: str, tag: TagInfo | None = None, line: int | None = None, template: str | None = None) -> None:
    long_error = f"{error}{' ' + format_tag(tag) if tag else ''}{' on line ' + str(line) if line else ''}{' for template ' + str(template) if template else ''}"
    formatted = {"tag": format_tag(tag), "line": line}
    raise SelmerValidationError(
        long_error,
        {
            "type": "selmer/validation-error",
            "error": error,
            "error_template": error_template,
            "error-template": error_template,
            "line": line,
            "template": template,
            "validation_errors": [formatted],
            "validation-errors": [formatted],
        },
    )


def validate_filters(template: str, line: int, tag: TagInfo) -> None:
    body = tag.tag_value if tag.tag_type == "filter" else ""
    for part in split_value(body)[1:]:
        filter_name = part.split(":", 1)[0].strip()
        if filter_name and filter_name not in filters:
            validation_error(f"Unrecognized filter {body} found inside the tag", tag, line, template)


def _close_tags() -> list[str]:
    return [tag for tags in closing_tags.values() for tag in tags]


def validate_tag(template: str, line: int, stack: list[TagInfo], tag: TagInfo) -> list[TagInfo]:
    if tag.tag_type == "filter":
        validate_filters(template, line, tag)
        return stack
    for arg in tag.args:
        validate_filters(template, line, FilterTagInfo("filter", arg))
    last_tag = stack[-1] if stack else None
    end_tags = closing_tags.get(last_tag.tag_name, []) if isinstance(last_tag, ExprTagInfo) else []
    if not tag.tag_name:
        validation_error("No tag name supplied for the tag", tag, line, template)
    if tag.tag_name not in _close_tags() and tag.tag_name not in expr_tags:
        validation_error("Unrecognized tag found", tag, line, template)
    if tag.tag_name in _close_tags():
        without_last = stack[:-1]
        if tag.tag_name in end_tags:
            return [*without_last, tag] if closing_tags.get(tag.tag_name) else without_last
        validation_error("No closing tag found for the tag", last_tag, line, template)
    if closing_tags.get(tag.tag_name):
        return [*stack, tag]
    return stack


def _skip_verbatim(scanner: Scanner, tag: TagInfo) -> None:
    if tag.tag_type != "expr" or tag.tag_name != "verbatim":
        return
    while not scanner.eof():
        if scanner.startswith(scanner.delimiters.tag_open + scanner.delimiters.tag_second):
            next_tag = scanner.read_tag_info()
            if next_tag.tag_type == "expr" and next_tag.tag_name == "endverbatim":
                return
        else:
            scanner.read_char()


def validate_tags(content: str, template: str, **opts: Any) -> list[TagInfo]:
    scanner = Scanner(content, make_delimiters(**opts))
    line = 1
    stack: list[TagInfo] = []
    while not scanner.eof():
        if scanner.starts_tag():
            try:
                tag = scanner.read_tag_info()
                if tag.tag_type == "expr" and tag.tag_name == "verbatim":
                    _skip_verbatim(scanner, tag)
                else:
                    stack = validate_tag(template, line, stack, tag)
            except Exception as exc:
                if isinstance(exc, SelmerValidationError):
                    raise
                validation_error(f"Error parsing the tag: {exc}", None, line, template)
        else:
            if scanner.read_char() == "\n":
                line += 1
    return stack


def validate(template: str, **opts: Any) -> None:
    if not _validate:
        return
    content, _resource = read_resource(template, **opts)
    orphan_tags = validate_tags(content, template, **opts)
    if orphan_tags:
        first = orphan_tags[0]
        validation_error(
            "The template contains orphan tags: " + ", ".join(format_tag(tag) for tag in orphan_tags),
            first,
            None,
            template,
        )
