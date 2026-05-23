import { afterEach, describe, expect, it } from "vitest";
import {
  addFilter,
  addTag,
  basicEdnToHtml,
  cacheOff,
  cacheOn,
  clearCache,
  knownVariablePaths,
  knownVariables,
  parseInput,
  preprocessTemplateFile,
  removeFilter,
  removeTag,
  render,
  renderFile,
  renderTemplate,
  resetMissingValueFormatter,
  resolveArg,
  setMissingValueFormatter,
  tagHandler,
  turnOffEscaping,
  turnOnEscaping,
  validateOff,
  validateOn,
  withoutEscaping,
  withEscaping
} from "../../src/index.js";

afterEach(() => {
  turnOnEscaping();
  resetMissingValueFormatter();
  validateOn();
  cacheOn();
  clearCache();
});

const fixLineSep = (s: string) => s.replace(/\n/g, "\n");

describe("rendering basics", () => {
  it("passes plain text through and injects variables", () => {
    expect(render("a b c d", {})).toBe("a b c d");
    expect(render("{{blah}} a b c d", {})).toBe(" a b c d");
    expect(render("{{blah}} a b c d", { blah: "blah" })).toBe("blah a b c d");
    expect(render("{a b c} \nd", {})).toBe("{a b c} \nd");
    expect(render("Hello {{name}}", { name: true })).toBe("Hello true");
    expect(render("Hello {{name}}", { name: false })).toBe("Hello false");
    expect(render("{{foo.bar.0.baz}}", { foo: { bar: [{ baz: "hi" }] } })).toBe("hi");
    expect(render("{{foo..bar/baz}}", { "foo.bar/baz": "hello" })).toBe("hello");
  });

  it("reports parser errors", () => {
    expect(() => render("{{blah|safe|woot}}", { blah: "woot" })).toThrow("No filter defined with the name 'woot'");
    expect(() => render("{{blah|safe|woot", { blah: "woot" })).toThrow("Expected closing delimiter");
  });

  it("supports custom delimiters", () => {
    expect(render("[% for ele in foo %]<<[{ele}]>>[%endfor%]", { foo: [1, 2, 3] }, { tagOpen: "[", tagClose: "]" })).toBe("<<1>><<2>><<3>>");
  });
});

describe("customization", () => {
  it("supports custom tags", () => {
    const block = tagHandler((_args, _context, content) => content?.foo?.content, "foo", "endfoo");
    expect(render("{% foo %}some {{bar}} content{% endfoo %}", { bar: "bar" }, { customTags: { foo: block } })).toBe("some bar content");

    const inline = tagHandler((args) => args.join(","), "bar");
    expect(render("{% bar arg1 arg2 %}", {}, { customTags: { bar: inline } })).toBe("arg1,arg2");

    addTag("temp", (args) => `TEMP_${args.map((a) => a.toUpperCase()).join("_")}`);
    expect(render("{% temp arg1 arg2 %}", {})).toBe("TEMP_ARG1_ARG2");
    removeTag("temp");
    expect(() => render("{% temp arg1 arg2 %}", {})).toThrow();
  });

  it("supports custom filters", () => {
    expect(render("{{bar|embiginate}}", { bar: "bar" }, { customFilters: { embiginate: (s) => String(s).toUpperCase() } })).toBe("BAR");
    addFilter("temp", (x) => `TEMP_${String(x).toUpperCase()}`);
    expect(render("{{x|temp}}", { x: "foo_bar" })).toBe("TEMP_FOO_BAR");
    removeFilter("temp");
    expect(() => render("{{x|temp}}", { x: "foo_bar" })).toThrow();
  });
});

describe("inheritance and includes", () => {
  it("preprocesses extends, blocks, block.super, and includes", () => {
    expect(preprocessTemplateFile("templates/inheritance/child-b.html")).toBe(fixLineSep(`<html>
<body>{% block header %}
B header

<h1>child-a header</h1>
<<
original header
>>

{% endblock %}

<div>{% block content %}
Some content
{% endblock %}</div>

{% block footer %}
<p>footer</p>
{% endblock %}</body>
</html>`));
    expect(renderFile("templates/inheritance/child-c.html", {})).toBe(fixLineSep(`<head><script src="my/C/script" /></head>

<body>my-body</body>
`));
    expect(preprocessTemplateFile("templates/inheritance/super-b.html")).toBe(fixLineSep(`<html>
    <head></head>
    <body>
        {% block hello %}

            Hello 
         World
{% endblock %}
    </body>
</html>`));
    expect(renderFile("templates/inheritance/include-in-block.html", {})).toBe(fixLineSep(`<div>
hello
</div>
`));
  });

  it("renders included templates and include defaults", () => {
    expect(renderFile("templates/child.html", {})).toBe(fixLineSep("Base template.\n\n\t\n<p></p>\n\n\n"));
    expect(renderFile("templates/child.html", { content: "blah" })).toBe(fixLineSep("Base template.\n\n\t\n<p>blah</p>\n\n\n"));
    expect(renderFile("templates/include.html", {})).toBe("/page?name=foo - abc");
    expect(renderFile("templates/include.html", { gridid: "xyz" })).toBe("/page?name=foo - xyz");
    expect(renderFile("templates/inheritance/include/another-grandparent.html", {})).toBe("foo bar baz default-value other-default-value");
    expect(renderFile("templates/inheritance/include/another-grandparent.html", { "my-variable": "some-value" })).toBe("foo bar baz some-value other-default-value");
  });

  it("uses cache controls", () => {
    cacheOff();
    expect(renderFile("templates/my-include.html", { foo: "foo" })).toBe("main template foo body");
    cacheOn();
    expect(renderFile("templates/my-include.html", { foo: "bar" })).toBe("main template bar body");
  });
});

describe("tags", () => {
  it("renders if, elif, comparisons, any, and all", () => {
    expect(render("{% if any foo bar baz %}hello{% endif %}", { bar: "foo" })).toBe("hello");
    expect(render("{% if not any foo bar baz %}hello{% endif %}", {})).toBe("hello");
    expect(render("{% if all foo bar %}hello{% endif %}", { foo: "foo", bar: "bar" })).toBe("hello");
    expect(render("{% if all foo bar %}hello{% endif %}", { foo: "foo" })).toBe("");
    expect(render("{% if v > 2 %}bigger{% endif %}", { v: 3 })).toBe("bigger");
    expect(render("{% if v > -2 %}bigger{% endif %}", { v: -3 })).toBe("");
    expect(render("{% if 5 = v %}equal{% endif %}", { v: 5 })).toBe("equal");
    expect(render("{% if fruit = \"banana\"%}for monkey{% else %}not banana{% endif %}", { fruit: "banana" })).toBe("for monkey");
    expect(render("{% if foo %}foo{% elif bar %}bar{% elif baz %}baz{% else %}else{% endif %}", { bar: true, baz: true })).toBe("bar");
  });

  it("renders ifequal and ifunequal", () => {
    expect(render("{% ifequal foo|upper \"FOO\" %}yez{% endifequal %}", { foo: "foo" })).toBe("yez");
    expect(render("{% ifequal foo \"foo\" %}foo{% else %}no foo{% endifequal %}", { foo: false })).toBe("no foo");
    expect(render("{% ifunequal foo \"bar\" %}yez{% endifunequal %}", { foo: "foo" })).toBe("yez");
    expect(render("{% ifunequal foo \"foo\" %}yez{% endifunequal %}", { foo: "foo" })).toBe("");
  });

  it("renders for loops including empty, filters, destructuring, and forloop metadata", () => {
    expect(render("{%for x in foo.0%} {{x.id}} {%endfor%}", { foo: [[{ id: "s" }, { id: "a" }]] })).toBe(" s  a ");
    expect(render("<ul>{% for athlete in athlete_list %}<li>{{ athlete.name }}</li>{% empty %}<li>Sorry, no athletes in this list.</li>{% endfor %}<ul>", {})).toBe("<ul><li>Sorry, no athletes in this list.</li><ul>");
    expect(render("{% for x in foo.bar|sort %}{{x}}{% endfor %}", { foo: { bar: [1, 4, 3, 5] } })).toBe("1345");
    expect(render("{% for x in foo.bar|sort|sort-reversed %}{{x}}{% endfor %}", { foo: { bar: [1, 4, 3, 5] } })).toBe("5431");
    expect(render("{% for a,b,c in items %}{{a}},{{b}},{{c}};{% endfor %}", { items: [[1, 2, "a", "b"], [3, 4]] })).toBe("1,2,a;3,4,;");
    expect(render("{% for i in 3|range:1:2 %}i={{i}};{% endfor %}", {})).toBe("i=1;");
    expect(render("{% for ele in foo %}{{ele}}-{{forloop.counter}}-{{forloop.counter0}}-{{forloop.revcounter}}-{{forloop.revcounter0}};{%endfor%}", { foo: [1, 2, 3] })).toBe("1-1-0-2-3;2-2-1-1-2;3-3-2-0-1;");
  });

  it("renders utility tags", () => {
    expect(render("{% with total=business.employees|count %}{{ total }} employee{{ business.employees|pluralize }}{% endwith %}", { business: { employees: [0, 1, 2, 3, 4] } })).toBe("5 employees");
    expect(render("{% with math=\"1+1=2\" %}{{ math }}{% endwith %}", {})).toBe("1+1=2");
    expect(render("foo bar {% comment %} baz test {{x}} {% endcomment %} blah", {})).toBe("foo bar  blah");
    expect(render("foo bar {# baz test {{x}} #} blah", {})).toBe("foo bar  blah");
    expect(render("{% firstof var1 var2 var3 %}", { var2: "x", var3: "not me" })).toBe("x");
    expect(render("{% verbatim %}{{if dying}}Still alive.{{/if}}{% endverbatim %}", {})).toBe("{{if dying}}Still alive.{{/if}}");
    expect(render("{% safe %}{{foo|upper}}{% endsafe %}", { foo: "<foo>" })).toBe("<FOO>");
    expect(render("{% sum foo bar.baz \\1 %}", { foo: 2, bar: { baz: 3 } })).toBe("6");
    expect(render("{% cycle \"foo\" \"bar\" %}{% cycle \"foo\" \"bar\" %}", {})).toBe("\"foo\"\"foo\"");
  });

  it("renders script and style tags", () => {
    expect(render("{% script \"/js/site.js\" %}", {})).toBe("<script src=\"/js/site.js\" type=\"application/javascript\"></script>");
    expect(render("{% script path|upper %}", { "selmer/context": "/myapp", path: "/js/site.js" })).toBe("<script src=\"/myapp/JS/SITE.JS\" type=\"application/javascript\"></script>");
    expect(render("{% script \"/js/site.js\" async=1 defer=1 type=\"module\" %}", {})).toBe("<script async defer src=\"/js/site.js\" type=\"module\"></script>");
    expect(render("{% style path %}", { "selmer/context": "/myapp", path: "/css/screen.css" })).toBe("<link href=\"/myapp/css/screen.css\" rel=\"stylesheet\" type=\"text/css\" />");
  });
});

describe("filters", () => {
  it("renders string, numeric, collection, and escaping filters", () => {
    expect(render("{{f|upper}}", { f: "foo" })).toBe("FOO");
    expect(render("{{\"FOObar\"|lower}}", {})).toBe("foobar");
    expect(render("{{f|subs:0:3:\" ...\"}}", { f: "FOO BAR" })).toBe("FOO ...");
    expect(render("{{seed|add:1:2:3}}", { seed: 34 })).toBe("40");
    expect(render("{{foo|multiply:3}}", { foo: 3.33 })).toBe("9.99");
    expect(render("{{foo|divide:2}}", { foo: 3 })).toBe("1.5");
    expect(render("{{foo|round}}", { foo: 3.33333 })).toBe("3");
    expect(render("{{sequence|join:\", \"}}", { sequence: [1, 2, 3, 4] })).toBe("1, 2, 3, 4");
    expect(render("{{seq|drop:2|join:\" \"}}", { seq: ["a", "b", "c", "d"] })).toBe("c d");
    expect(render("{{seq|take:2}}", { seq: [":dog", ":cat", ":bird"] })).toBe("[:dog :cat]");
    expect(render("{{xs|empty?}}", { xs: [] })).toBe("true");
    expect(render("{{foo|replace:foo:bar}}", { foo: "foo test foo" })).toBe("bar test bar");
    expect(render("{{f|hash:\"md5\"|upper}}", { f: "foo" })).toBe("ACBD18DB4CC2F85CEDEF654FCCC4A4D8");
    expect(render("{{data|json}}", { data: { foo: 27 } })).toBe("{&quot;foo&quot;:27}");
    expect(render("{{data|json|safe}}", { data: { foo: 27 } })).toBe('{"foo":27}');
  });

  it("renders specialized filters", () => {
    expect(render("{{e|email}}", { e: "foo@bar.baz" })).toBe("<a href='mailto:foo@bar.baz'>foo@bar.baz</a>");
    expect(render("{{p|phone:44}}", { p: "01234 567890" })).toBe("<a href='tel:+44-1234-567890'>01234 567890</a>");
    expect(render("{{f|pluralize:y:ies}}", { f: [1, 2, 3] })).toBe("ies");
    expect(render("{{f|pluralize:y:ies}}", { f: [1] })).toBe("y");
    expect(render("{{foo|between?:2:4}}", { foo: 3 })).toBe("true");
    expect(render("{{value|remove-tags:b:span}}", { value: "<b><span>foobar</span></b>" })).toBe("foobar");
    expect(render("{{name|default:@v|count}}", { v: [1, 2, 3, 4] })).toBe("4");
    expect(render("{{name|default:@foo.bar.baz}}", { foo: { bar: { baz: "quux" } } })).toBe("quux");
  });

  it("controls escaping", () => {
    expect(render("<tag>{{f}}</tag>", { f: "<foo bar=\"baz\">\\>" })).toBe("<tag>&lt;foo bar=&quot;baz&quot;&gt;\\&gt;</tag>");
    expect(render("{{f}}", { f: "&\"'<>" })).toBe("&amp;&quot;&#39;&lt;&gt;");
    expect(render("{{f|safe}}", { f: "<foo>" })).toBe("<foo>");
    turnOffEscaping();
    expect(render("{{name}}", { name: "I <3 ponies" })).toBe("I <3 ponies");
    turnOnEscaping();
    expect(withoutEscaping(() => render("{{name}}", { name: "I <3 ponies" }))).toBe("I <3 ponies");
    turnOffEscaping();
    expect(withEscaping(() => render("{{name}}", { name: "I <3 ponies" }))).toBe("I &lt;3 ponies");
  });
});

describe("missing values and introspection", () => {
  it("supports missing value formatters", () => {
    expect(render("{{missing}}", {})).toBe("");
    setMissingValueFormatter(() => "XXX", { filterMissingValues: false });
    expect(render("{{missing}}", {})).toBe("XXX");
    expect(render("{{missing|count}}", {})).toBe("XXX");
    setMissingValueFormatter(() => "XXX", { filterMissingValues: true });
    expect(render("{{missing|count}}", {})).toBe("0");
  });

  it("finds known variables", () => {
    expect([...knownVariables("{{name|capitalize}}")] ).toEqual(["name"]);
    expect(new Set(knownVariables("{% if any foo bar baz %}hello{% endif %}"))).toEqual(new Set(["foo", "bar", "baz"]));
    expect(knownVariablePaths("{% for x in some-list.nested1 %}{{x.more.nested2}}{% endfor %}")).toEqual([["some-list", "nested1"]]);
  });

  it("resolves tag arguments", () => {
    expect(resolveArg("{{variable}}", { variable: "John" })).toBe("John");
    expect(resolveArg("Hello {{variable|upper}}!", { variable: "John" })).toBe("Hello JOHN!");
    expect(resolveArg("{% if variable = \"John\" %}Mr {{variable}}{% endif %}", { variable: "John" })).toBe("Mr John");
    expect(resolveArg("\"Hello John!\"", {})).toBe("Hello John!");
  });

  it("renders debug output", () => {
    expect(render("{% debug %}", { "debug-value": 1 })).toContain("debug-value");
    expect(basicEdnToHtml({ a: "<pre>" })).toContain("&lt;pre&gt;");
  });

  it("can parse and render a compiled template", () => {
    const template = parseInput("<ul>{% for item in items %}<li>{{item}}</li>{% endfor %}</ul>");
    expect(renderTemplate(template, { items: [0, 1, 2] })).toBe("<ul><li>0</li><li>1</li><li>2</li></ul>");
  });

  it("can disable validation", () => {
    validateOff();
    expect(renderFile("templates/verbatim.html", {})).toContain("{%=file.name%}");
  });
});
