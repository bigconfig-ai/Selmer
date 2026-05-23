from __future__ import annotations

from selmer.filter_parser import compile_filter_body, escape_html_star, split_value
from selmer.util import get_accessor, parse_accessor


def test_get_accessor() -> None:
    assert get_accessor([1], 0) == 1
    assert get_accessor({"foo": 1}, "foo") == 1
    assert get_accessor({":foo": 1}, "foo") == 1
    assert parse_accessor("foo.bar.0.baz") == ["foo", "bar", 0, "baz"]
    assert parse_accessor("some..namespace/keyword") == ["some.namespace/keyword"]


def test_split_value_respects_quotes() -> None:
    assert split_value('foo|join:", "|upper') == ["foo", 'join:", "', "upper"]


def test_compile_filter_body() -> None:
    compiled = compile_filter_body("foo.bar|upper")
    assert compiled({"foo": {"bar": "baz"}}) == "BAZ"


def test_escape_html_star() -> None:
    assert escape_html_star("&\"'<>") == "&amp;&quot;&#39;&lt;&gt;"
