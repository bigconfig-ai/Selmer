import { describe, expect, it } from "vitest";
import { compileFilterBody, escapeHtmlStar, splitValue } from "../../src/filter-parser.js";
import { getAccessor, parseAccessor } from "../../src/util.js";

describe("filter parser helpers", () => {
  it("gets nested values with string and numeric keys", () => {
    expect(getAccessor([1], 0)).toBe(1);
    expect(getAccessor({ foo: 1 }, "foo")).toBe(1);
    expect(getAccessor({ ":foo": 1 }, "foo")).toBe(1);
    expect(parseAccessor("foo.bar.0.baz")).toEqual(["foo", "bar", 0, "baz"]);
    expect(parseAccessor("some..namespace/keyword")).toEqual(["some.namespace/keyword"]);
  });

  it("splits filter bodies while respecting quoted delimiters", () => {
    expect(splitValue('foo|join:", "|upper')).toEqual(["foo", 'join:", "', "upper"]);
  });

  it("compiles filter bodies", () => {
    const compiled = compileFilterBody("foo.bar|upper");
    expect(compiled({ foo: { bar: "baz" } })).toBe("BAZ");
  });

  it("escapes the Django HTML characters", () => {
    expect(escapeHtmlStar("&\"'<>")) .toBe("&amp;&quot;&#39;&lt;&gt;");
  });
});
