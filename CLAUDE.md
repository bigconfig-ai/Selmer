# CLAUDE.md

This file describes the `selmer` Clojure codebase for AI assistants. Read it before making changes.

## Project Overview

This directory is the upstream Selmer Clojure library — a fast, Django-inspired template system in pure Clojure (originally `yogthos/Selmer`). The Python and TypeScript siblings (`../python`, `../typescript`) are ports of this implementation; treat this one as the reference.

It is consumed by the Clojure SDK (`big-config/clojure`) as the Maven artifact `selmer/selmer {:mvn/version "1.13.1"}`.

## Tech Stack

- **Language**: Clojure (works against Clojure 1.9+)
- **Build**: `deps.edn` + `build.clj` (uses `io.github.seancorfield/build-clj`)
- **Tests**: Kaocha (`:test` alias) and `clojure.test`
- **Legacy**: a `project.clj` is also present for Leiningen consumers

## Repository Layout

```
selmer/clojure/
├── src/selmer/
│   ├── parser.clj           # Public API: render, render-file, parse-*, render-template
│   ├── template_parser.clj  # Template inheritance + include resolution
│   ├── filter_parser.clj    # Filter expression parser
│   ├── filters.clj          # Built-in filters
│   ├── tags.clj             # Built-in tags (if/for/block/extends/include/...)
│   ├── node.clj             # AST node compilation
│   ├── validator.clj        # Template validation
│   ├── middleware.clj       # Ring middleware integration
│   └── util.clj             # Shared helpers
├── resources/                # Built-in error page + templates
├── dev/                      # REPL dev namespace
├── test/                     # Test suite (Kaocha)
├── deps.edn
├── project.clj              # Leiningen project (legacy)
└── build.clj
```

## Development Commands

```bash
# Run the full Kaocha-driven test suite (also AOT-compiles selmer.node):
clojure -T:build test

# Basic test run via Clojure CLI (no AOT):
clojure -X:dev:test

# Development REPL:
clj -A:dev
clj -A:dev:test

# AOT-compile selmer.node manually (only required when using as a Git dep):
clojure -T:build prep

# build.clj help:
clojure -T:build:deps help/doc :ns build
```

## Public API (re-exported from `selmer.parser`)

| Function | Purpose |
|---|---|
| `render` | Render a template string with a context map |
| `render-file` | Render a file or resource path |
| `parse` / `parse-input` | Parse a template into an AST |
| `render-template` | Render an already-parsed AST |
| `add-filter!` / `add-tag!` | Register custom filters and tags |
| `cache-on!` / `cache-off!` | Toggle the template cache |
| `set-resource-path!` | Pin the lookup root for `render-file` |
| `known-variables` | Static analysis of variables a template references |

## Template Language Surface

- Variables: `{{ name }}`, `{{ person.address.0.street }}`, double-dot for namespaced keys (`{{ foo..bar/baz }}`).
- Filters: `{{ name|upper }}`, chainable; custom filters via `add-filter!`.
- Tags: `{% if %}`, `{% for %}`, `{% block %}`, `{% extends %}`, `{% include %}`, `{% comment %}`, `{% cycle %}`, `{% safe %}`, etc.
- Inheritance: `{% extends "base.html" %} {% block name %}...{% endblock %}`.
- Custom delimiters: pass `:tag-open`, `:tag-close`, `:filter-open`, `:filter-close` to `render` (BigConfig SDK uses this to switch variables to `<{ ... }>` so downstream Ansible's `{{ ... }}` passes through).

## Code Conventions

- Public API is what `selmer.parser` re-exports — keep that surface stable; downstream SDK consumers (`big-config`) depend on exact signatures.
- `selmer.node` is AOT-compiled and listed under `:deps/prep-lib` so consumers (`clojure -X:deps prep`) can use this repo directly as a Git dep — keep `:ensure "target/classes"` working.
- Tests live under `test/selmer/`; mirror namespace structure under `src/selmer/`.
- License is EPL-1.0 (see `LICENSE`).

## What to Avoid

- Do not change public function signatures in `selmer.parser` without coordinating with the Clojure SDK (`big-config/clojure`) and the Python/TypeScript ports.
- Do not remove the Leiningen `project.clj` — some downstream consumers still use it.

## Git

Stay on `clojure` (each language has its own branch in this repo). Commit only when explicitly asked. Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `deps:`).
