# Selmer for Python

A dependency-free Python 3.12 port of [Selmer](https://github.com/yogthos/Selmer), a Django-style template system.

This package keeps Selmer's core template language and API shape: variables, filters, tags, includes, template inheritance, validation, caching, missing-value handling, and custom tags/filters.

## Requirements

- Python 3.12+
- Runtime dependencies: none
- Project/test runner: `uv`
- Tests: `pytest`

## Install for development

```sh
uv sync
uv run pytest
```

## Usage

```python
from selmer import render, render_file

render("Hello {{name}}!", {"name": "Yogthos"})
# "Hello Yogthos!"

render("{% for item in items %}<li>{{item}}</li>{% endfor %}", {
    "items": [1, 2, 3],
})
# "<li>1</li><li>2</li><li>3</li>"

render_file("templates/home.html", {"name": "Yogthos"})
```

## Main API

```python
render(template: str, context: Mapping | None = None, **opts) -> str
render_file(path: str, context: Mapping | None = None, **opts) -> str
parse_string(template: str, **opts) -> list[TemplateNode]
parse_file(path: str, **opts) -> list[TemplateNode]
parse_input(template_or_path: str, **opts) -> list[TemplateNode]
render_template(template: list[TemplateNode], context: Mapping) -> str
```

Clojure-style mutating names are exposed with Python-safe suffixes, for example `cache_on_bang`, `add_filter_bang`, and `validate_off_bang`. Idiomatic aliases without the suffix are also provided.

## Variables

```python
render("{{person.name}}", {"person": {"name": "John"}})
render("{{foo.bar.0.baz}}", {"foo": {"bar": [{"baz": "hi"}]}})
```

Namespaced-style keys can be escaped with a double dot:

```python
render("{{foo..bar/baz}}", {"foo.bar/baz": "hello"})
```

## Filters

```python
render("{{name|upper}}", {"name": "selmer"})
render("{{items|count}}", {"items": [1, 2, 3]})
render("{{value|default:\"fallback\"}}", {})
render("{{html|safe}}", {"html": "<strong>ok</strong>"})
```

Built-in filters include `upper`, `lower`, `capitalize`, `title`, `default`, `default-if-empty`, `safe`, `json`, `join`, `count`, `length`, `range`, `sort`, `sort-by`, `add`, `multiply`, `divide`, `round`, `hash`, `email`, `phone`, `pluralize`, `remove-tags`, and the other Selmer filters ported from the Clojure version.

### Custom filters

```python
from selmer import add_filter, remove_filter, render

add_filter("embiginate", lambda value: str(value).upper())
render("{{shout|embiginate}}", {"shout": "hello"})
# "HELLO"

remove_filter("embiginate")
```

## Tags

Built-in tags include `if`, `elif`, `else`, `ifequal`, `ifunequal`, `for`, `empty`, `with`, `include`, `extends`, `block`, `comment`, `cycle`, `debug`, `firstof`, `now`, `safe`, `script`, `style`, and `verbatim`.

```python
render("{% if user %}Hello {{user}}{% else %}Hello guest{% endif %}", {
    "user": "Jane",
})

render("{% for x in xs %}{{x}}{% empty %}none{% endfor %}", {
    "xs": [1, 2, 3],
})
```

### Custom tags

```python
from selmer import add_tag, remove_tag, render

add_tag("join", lambda args, context: ",".join(args))
render("{% join a b c %}", {})
# "a,b,c"

remove_tag("join")
```

Block tags receive rendered block content:

```python
add_tag(
    "uppercase",
    lambda args, context, content: content["uppercase"]["content"].upper(),
    "enduppercase",
)

render("{% uppercase %}hello {{name}}{% enduppercase %}", {"name": "selmer"})
# "HELLO SELMER"
```

## Template inheritance and includes

```html
<!-- base.html -->
<html>
<body>
{% block content %}{% endblock %}
</body>
</html>
```

```html
<!-- child.html -->
{% extends "base.html" %}
{% block content %}Hello {{name}}{% endblock %}
```

```python
render_file("child.html", {"name": "Python"})
```

Includes and include defaults are supported:

```html
{% include "partials/header.html" %}
{% include "card.html" with title="Untitled" %}
```

## Escaping

Variables are HTML-escaped by default.

```python
from selmer import turn_off_escaping, turn_on_escaping, without_escaping

render("{{x}}", {"x": "<tag>"})
# "&lt;tag&gt;"

render("{{x|safe}}", {"x": "<tag>"})
# "<tag>"

without_escaping(lambda: render("{{x}}", {"x": "<tag>"}))
```

## Missing values

Missing values render as an empty string by default.

```python
from selmer import set_missing_value_formatter

set_missing_value_formatter(
    lambda tag, context: f"<missing {tag.get('tag_value') or tag.get('tag_name')}>",
    filter_missing_values=False,
)
```

## Validation

```python
from selmer import validate_on, validate_off

validate_off()
validate_on()
```

## Introspection

```python
from selmer import known_variables, known_variable_paths

known_variables("{{person.name}}")
# {"person"}

known_variable_paths("{{person.name}}")
# [["person", "name"]]
```

## Development

```sh
uv sync
uv run pytest
uv build
```

## License

Copyright © 2015 Dmitri Sotnikov and contributors.

Distributed under the Eclipse Public License, the same as the original Selmer project.
