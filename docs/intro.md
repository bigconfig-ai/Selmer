# Introduction to Selmer for TypeScript

This directory contains the TypeScript/Node.js port of Selmer.

Selmer is a Django-style template engine. Templates are plain text with variable tags such as `{{name}}` and expression tags such as `{% if user %}...{% endif %}`.

## Goals

- Match Selmer's template language and public API closely.
- Run on Node.js as an ESM package.
- Keep the runtime dependency-free.
- Provide TypeScript declarations.
- Preserve Selmer features: filters, tags, includes, inheritance, validation, caching, custom tags/filters, escaping controls, and missing-value handling.

## Basic usage

```ts
import { render, renderFile } from "selmer";

render("Hello {{name}}!", { name: "TypeScript" });
// => "Hello TypeScript!"

renderFile("templates/home.html", { title: "Home" });
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
npm install
npm test
npm run check
npm run build
```

See the root `README.md` for the full TypeScript API.
