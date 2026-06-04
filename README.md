# Selmer for TypeScript

A dependency-free runtime TypeScript/Node.js port of [Selmer](https://github.com/yogthos/Selmer), a fast Django-style template system.

This package keeps Selmer's core API and template language: variables, filters, tags, includes, template inheritance, validation, caching, missing-value handling, and custom tags/filters.

## Install

Within the BigConfig workspace this port is consumed by the TypeScript SDK as a GitHub-pinned dependency (e.g. `big-config/typescript` pins `github:bigconfig-ai/Selmer#<sha>` in `package.json`):

```sh
npm install github:bigconfig-ai/Selmer#<sha>
```

## Runtime

- Node.js
- ESM
- No runtime dependencies
- Vitest is used for tests

## Usage

```ts
import { render, renderFile } from "selmer";

render("Hello {{name}}!", { name: "Yogthos" });
// => "Hello Yogthos!"

render("{% for item in items %}<li>{{item}}</li>{% endfor %}", {
  items: [1, 2, 3]
});
// => "<li>1</li><li>2</li><li>3</li>"

renderFile("templates/home.html", { name: "Yogthos" });
```

## Main API

```ts
render(template: string, context?: Context, opts?: RenderOptions): string
renderFile(pathOrUrl: string | URL, context?: Context, opts?: RenderOptions): string
parseString(template: string, opts?: RenderOptions): ParsedTemplate
parseFile(pathOrUrl: string | URL, opts?: RenderOptions): ParsedTemplate
parseInput(template: string, opts?: RenderOptions): ParsedTemplate
renderTemplate(template: TemplateNode[], context: Context): string
```

### Cache

```ts
import { cacheOn, cacheOff, clearCache } from "selmer";

cacheOff();
cacheOn();
clearCache();
```

### Resource path

```ts
import { setResourcePath } from "selmer";

setResourcePath("/var/html/templates/");
setResourcePath(null);
```

## Variables

```ts
render("{{person.name}}", { person: { name: "John" } });
render("{{foo.bar.0.baz}}", { foo: { bar: [{ baz: "hi" }] } });
```

Namespaced-style keys can be escaped with a double dot, matching Selmer:

```ts
render("{{foo..bar/baz}}", { "foo.bar/baz": "hello" });
```

## Filters

```ts
render("{{name|upper}}", { name: "selmer" });
render("{{items|count}}", { items: [1, 2, 3] });
render("{{value|default:\"fallback\"}}", {});
render("{{html|safe}}", { html: "<strong>ok</strong>" });
```

Built-in filters include:

`abbr-left`, `abbr-middle`, `abbr-right`, `abbr-ellipsis`, `abbreviate`, `add`, `addslashes`, `between?`, `capitalize`, `center`, `count`, `count-is`, `currency-format`, `date`, `default`, `default-if-empty`, `divide`, `double-format`, `drop`, `drop-last`, `email`, `empty?`, `first`, `get`, `get-digit`, `hash`, `join`, `json`, `last`, `length`, `length-is`, `linebreaks`, `linebreaks-br`, `linenumbers`, `lower`, `multiply`, `name`, `not-empty`, `number-format`, `phone`, `pluralize`, `rand-nth`, `range`, `remove`, `remove-tags`, `replace`, `round`, `safe`, `sort`, `sort-by`, `sort-by-reversed`, `sort-reversed`, `str`, `subs`, `take`, `title`, `upper`, `urlescape`.

### Custom filters

```ts
import { addFilter, removeFilter, render } from "selmer";

addFilter("embiginate", (value) => String(value).toUpperCase());
render("{{shout|embiginate}}", { shout: "hello" });
// => "HELLO"

removeFilter("embiginate");
```

## Tags

Built-in tags include:

`block`, `comment`, `cycle`, `debug`, `extends`, `firstof`, `for`, `if`, `ifequal`, `ifunequal`, `include`, `now`, `safe`, `script`, `style`, `verbatim`, `with`.

```ts
render("{% if user %}Hello {{user}}{% else %}Hello guest{% endif %}", {
  user: "Jane"
});

render("{% for x in xs %}{{x}}{% empty %}none{% endfor %}", {
  xs: [1, 2, 3]
});
```

### Custom tags

```ts
import { addTag, removeTag, render } from "selmer";

addTag("join", (args) => args.join(","));
render("{% join a b c %}", {});
// => "a,b,c"

removeTag("join");
```

Block tags receive rendered block content:

```ts
addTag(
  "uppercase",
  (_args, _context, content) => content?.uppercase?.content.toUpperCase(),
  "enduppercase"
);

render("{% uppercase %}hello {{name}}{% enduppercase %}", { name: "selmer" });
// => "HELLO SELMER"
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

```ts
renderFile("child.html", { name: "TypeScript" });
```

Includes are supported:

```html
{% include "partials/header.html" %}
```

Include defaults are supported:

```html
{% include "card.html" with title="Untitled" %}
```

## Escaping

Variables are HTML-escaped by default.

```ts
import { turnOffEscaping, turnOnEscaping, withoutEscaping } from "selmer";

render("{{x}}", { x: "<tag>" });
// => "&lt;tag&gt;"

render("{{x|safe}}", { x: "<tag>" });
// => "<tag>"

withoutEscaping(() => render("{{x}}", { x: "<tag>" }));
```

## Missing values

Missing values render as an empty string by default.

```ts
import { setMissingValueFormatter } from "selmer";

setMissingValueFormatter((tag) => `<missing ${tag.tagValue ?? tag.tagName}>`, {
  filterMissingValues: false
});
```

## Validation

```ts
import { validateOn, validateOff } from "selmer";

validateOff();
validateOn();
```

## Introspection

```ts
import { knownVariables, knownVariablePaths } from "selmer";

knownVariables("{{person.name}}");
// Set { "person" }

knownVariablePaths("{{person.name}}");
// [["person", "name"]]
```

## Development

```sh
npm install
npm test
npm run check
npm run build
```

## License

Copyright © 2015 Dmitri Sotnikov and contributors.

Distributed under the Eclipse Public License, the same as the original Selmer project.
