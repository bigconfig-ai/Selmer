# Introduction to Selmer for Python

This directory contains the Python 3.12 port of Selmer.

Selmer is a Django-style template engine. Templates are plain text with variable tags such as `{{name}}` and expression tags such as `{% if user %}...{% endif %}`.

## Goals

- Match Selmer's Clojure template language and API closely.
- Run on Python 3.12+.
- Keep the runtime dependency-free.
- Provide type hints and `py.typed`.
- Use `uv` and `pyproject.toml` for project metadata and development.
- Preserve Selmer features: filters, tags, includes, inheritance, validation, caching, custom tags/filters, escaping controls, and missing-value handling.

## Basic usage

```python
from selmer import render, render_file

render("Hello {{name}}!", {"name": "Python"})
# "Hello Python!"

render_file("templates/home.html", {"title": "Home"})
```

## Template examples

```html
{% if user %}
  Hello {{user.name}}
{% else %}
  Hello guest
{% endif %}
```

```html
<ul>
{% for item in items %}
  <li>{{item}}</li>
{% empty %}
  <li>No items</li>
{% endfor %}
</ul>
```

## Development

```sh
uv sync
uv run pytest
uv build
```

See the root `README.md` for the full Python API.
