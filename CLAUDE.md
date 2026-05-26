# CLAUDE.md

This file describes the `selmer` TypeScript codebase for AI assistants. Read it before making changes.

## Project Overview

This directory is a dependency-free TypeScript/Node.js port of the [Selmer](https://github.com/yogthos/Selmer) Django-style template system. The Clojure sibling (`../clojure`) is the upstream reference; this port preserves Selmer's core template language and public API shape (variables, filters, tags, includes, template inheritance, validation, caching, custom tags/filters).

It is consumed by `big-config/typescript` as a GitHub-pinned npm dependency.

## Tech Stack

- **Language**: TypeScript (ES2022)
- **Module system**: ESM-only, `NodeNext` module resolution
- **Runtime**: Node.js
- **Runtime dependencies**: none
- **Test runner**: [Vitest](https://vitest.dev/)

## Repository Layout

```
selmer/typescript/
├── src/
│   ├── index.ts             # Public API re-exports
│   ├── parser.ts            # render, renderFile, parse, renderTemplate
│   ├── template-parser.ts   # Template inheritance + include resolution
│   ├── filter-parser.ts     # Filter expression parser
│   ├── filters.ts           # Built-in filters
│   ├── tags.ts              # Built-in tags
│   ├── node.ts              # Node tree
│   ├── scanner.ts           # Tokenizer
│   ├── validator.ts         # Template validation
│   ├── middleware.ts        # Optional integration helpers
│   ├── safe.ts              # Auto-escape / safe-string handling
│   ├── types.ts             # Public type aliases
│   └── util.ts              # Shared helpers (assocIn, …)
├── resources/               # Built-in error-page template
├── docs/
├── test/                    # Vitest suite (mirrors src/)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Development Commands

```bash
npm install                              # install dev dependencies
npm test                                 # full Vitest run
npx vitest run test/parser.test.ts -t "name"   # single test
npm run check                            # tsc --noEmit
npm run build                            # tsc -> dist/
```

## Public API

Imported from `selmer` (also re-exported individually under subpath exports: `selmer/parser`, `selmer/filters`, etc.):

```ts
import { render, renderFile, parse, renderTemplate, addFilter, addTag } from "selmer";
```

| Function | Purpose |
|---|---|
| `render(template, context?, opts?)` | Render a template string |
| `renderFile(pathOrUrl, context?, opts?)` | Render from disk |
| `parse(template, opts?)` | Parse into a node tree |
| `renderTemplate(nodes, context)` | Render an already-parsed tree |
| `addFilter` / `addTag` | Register custom filters / tags |
| `cacheOn` / `cacheOff` | Toggle the template cache |
| `validateOff` | Disable validation |

## Template Language Surface

- Variables: `{{ name }}`, dotted paths (`{{ foo.bar.0.baz }}`); double-dot escapes namespaced keys (`{{ foo..bar/baz }}`).
- Filters: `{{ name|upper }}`, chainable.
- Tags: `{% if %}`, `{% for %}`, `{% block %}`, `{% extends %}`, `{% include %}`, etc.
- Custom delimiters: pass `tagOpen`, `tagClose`, `filterOpen`, `filterClose` in `opts` so downstream tools' `{{ ... }}` can pass through unrendered (used by `big-config`).

## Code Conventions

- **ESM-only** — keep it that way. Imports use explicit `.js` extensions (required by `NodeNext` resolution).
- **No runtime dependencies** — load-bearing constraint for downstream `big-config/typescript` users.
- Keep the public surface in `src/index.ts` and the subpath `exports` in `package.json` aligned with the Clojure reference's `selmer.parser` surface; downstream `big-config/typescript` depends on exact names.
- Mirror Clojure mutating-name semantics with idiomatic camelCase (`cacheOn`, `addFilter`); a `Bang` suffix is **not** used here — TypeScript users get idiomatic names only.
- Tests live under `test/` and mirror `src/` filenames.
- License is EPL-1.0 (matching upstream Selmer).

## What to Avoid

- Do not introduce runtime dependencies.
- Do not switch to CJS or drop the `.js` import extensions — both break consumers.
- Do not diverge from the Clojure reference's template-language semantics; if behavior must change, change it in `../clojure` first and port over.

## Git

Stay on `typescript` (each language has its own branch in this repo). Commit only when explicitly asked. Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `deps:`).
