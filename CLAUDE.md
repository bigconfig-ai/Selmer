# CLAUDE.md

This file describes the `selmer` Python codebase for AI assistants. Read it before making changes.

## Project Overview

This directory is a dependency-free Python 3.12 port of the [Selmer](https://github.com/yogthos/Selmer) Django-style template system. The Clojure sibling (`../clojure`) is the upstream reference; this port preserves Selmer's core template language and public API shape (variables, filters, tags, includes, template inheritance, validation, caching, custom tags/filters).

It is consumed by `big-config/python` as a Git-pinned dependency in `pyproject.toml`.

## Tech Stack

- **Language**: Python 3.12+
- **Runtime dependencies**: none (stdlib-only)
- **Package manager / dev runner**: [`uv`](https://docs.astral.sh/uv/)
- **Test runner**: [pytest](https://docs.pytest.org/)
- **Build backend**: `setuptools`

## Repository Layout

```
selmer/python/
├── src/selmer/
│   ├── __init__.py          # Public API re-exports
│   ├── parser.py            # render, render_file, parse_*, render_template
│   ├── template_parser.py   # Template inheritance + include resolution
│   ├── filter_parser.py     # Filter expression parser
│   ├── filters.py           # Built-in filters
│   ├── tags.py              # Built-in tags
│   ├── node.py              # Node tree
│   ├── scanner.py           # Tokenizer
│   ├── validator.py         # Template validation
│   ├── middleware.py        # Optional integration helpers
│   ├── safe.py              # Auto-escape / safe-string handling
│   ├── types.py             # Public type aliases
│   ├── util.py              # Shared helpers
│   └── resources/           # Built-in error-page template
├── test/                    # pytest suite (mirrors src/selmer/)
├── pyproject.toml
└── uv.lock
```

## Development Commands

```bash
uv sync                                 # install dev dependencies
uv run pytest                           # run the full test suite
uv run pytest test/test_parser.py::test_name   # run a single test
```

## Public API

Imported from `selmer`:

```python
from selmer import render, render_file, parse_string, parse_file, parse_input, render_template
```

| Function | Purpose |
|---|---|
| `render(template, context=None, **opts)` | Render a template string |
| `render_file(path, context=None, **opts)` | Render a template loaded from disk |
| `parse_string(template, **opts)` | Parse into a list of `TemplateNode` |
| `parse_file(path, **opts)` | Parse a file |
| `parse_input(s, **opts)` | Auto-detect string vs path |
| `render_template(nodes, context)` | Render an already-parsed AST |
| `add_filter` / `add_tag` | Register custom filters / tags |
| `cache_on` / `cache_off` / `clear_cache` | Manage the template cache |
| `validate_on` / `validate_off` | Toggle validation |
| `set_resource_path` | Pin the lookup root for `render_file` |
| `known_variables` / `known_variable_paths` | Static analysis of variables a template references |

Clojure-style mutating names use the `_bang` suffix as a stand-in for `!` (`cache_on_bang`, `add_filter_bang`, `add_tag_bang`, `validate_off_bang`, `set_resource_path_bang`, `clear_cache_bang`); the Pythonic aliases without the suffix are also exposed. Keep both forms — downstream code may use either spelling.

## Template Language Surface

- Variables: `{{ name }}`, dotted paths (`{{ foo.bar.0.baz }}`); double-dot escapes namespaced keys (`{{ foo..bar/baz }}`).
- Filters: `{{ name|upper }}`, chainable.
- Tags: `{% if %}`, `{% for %}`, `{% block %}`, `{% extends %}`, `{% include %}`, etc.
- Custom delimiters: pass `tag_open`, `tag_close`, `filter_open`, `filter_close` opts so downstream tools' `{{ ... }}` can pass through unrendered (used by `big-config`).

## Code Conventions

- Stdlib-only at runtime — do **not** add runtime dependencies.
- Keep the public surface in `__init__.py` aligned with `selmer.parser`'s Clojure surface (`render`, `render_file`, …); downstream `big-config/python` depends on exact names.
- Mirror Clojure's `add-filter!`/`add-tag!` naming via both the `_bang`-suffixed names and the idiomatic Python aliases — keep both exposed in `__init__.py`.
- `py.typed` marker is shipped; keep type hints accurate.
- License is EPL-1.0 (matching upstream Selmer).

## What to Avoid

- Do not introduce runtime dependencies — the stdlib-only constraint is load-bearing for downstream `big-config/python` users.
- Do not diverge from the Clojure reference's template-language semantics; if behavior must change, change it in `../clojure` first and port over.

## Git

Stay on `python` (each language has its own branch in this repo). Commit only when explicitly asked. Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `deps:`).
