from __future__ import annotations

import pytest

from selmer import (
    add_filter,
    add_tag,
    basic_edn_to_html,
    cache_off,
    cache_on,
    clear_cache,
    known_variable_paths,
    known_variables,
    parse_input,
    preprocess_template_file,
    remove_filter,
    remove_tag,
    render,
    render_file,
    render_template,
    reset_missing_value_formatter,
    resolve_arg,
    set_missing_value_formatter,
    tag_handler,
    turn_off_escaping,
    turn_on_escaping,
    validate_off,
    validate_on,
    with_escaping,
    without_escaping,
)


@pytest.fixture(autouse=True)
def reset_state() -> None:
    yield
    turn_on_escaping()
    reset_missing_value_formatter()
    validate_on()
    cache_on()
    clear_cache()


def test_rendering_basics() -> None:
    assert render("a b c d", {}) == "a b c d"
    assert render("{{blah}} a b c d", {}) == " a b c d"
    assert render("{{blah}} a b c d", {"blah": "blah"}) == "blah a b c d"
    assert render("{a b c} \nd", {}) == "{a b c} \nd"
    assert render("Hello {{name}}", {"name": True}) == "Hello true"
    assert render("Hello {{name}}", {"name": False}) == "Hello false"
    assert render("{{foo.bar.0.baz}}", {"foo": {"bar": [{"baz": "hi"}]}}) == "hi"
    assert render("{{foo..bar/baz}}", {"foo.bar/baz": "hello"}) == "hello"


def test_parser_errors() -> None:
    with pytest.raises(Exception, match="No filter defined with the name 'woot'"):
        render("{{blah|safe|woot}}", {"blah": "woot"})
    with pytest.raises(Exception, match="Expected closing delimiter"):
        render("{{blah|safe|woot", {"blah": "woot"})


def test_custom_delimiters() -> None:
    assert render("[% for ele in foo %]<<[{ele}]>>[%endfor%]", {"foo": [1, 2, 3]}, tag_open="[", tag_close="]") == "<<1>><<2>><<3>>"


def test_custom_tags_and_filters() -> None:
    block = tag_handler(lambda _args, _ctx, content: content["foo"]["content"], "foo", "endfoo")
    assert render("{% foo %}some {{bar}} content{% endfoo %}", {"bar": "bar"}, custom_tags={"foo": block}) == "some bar content"

    inline = tag_handler(lambda args, _ctx: ",".join(args), "bar")
    assert render("{% bar arg1 arg2 %}", {}, custom_tags={"bar": inline}) == "arg1,arg2"

    add_tag("temp", lambda args, _ctx: "TEMP_" + "_".join(arg.upper() for arg in args))
    assert render("{% temp arg1 arg2 %}", {}) == "TEMP_ARG1_ARG2"
    remove_tag("temp")
    with pytest.raises(Exception):
        render("{% temp arg1 arg2 %}", {})

    assert render("{{bar|embiginate}}", {"bar": "bar"}, custom_filters={"embiginate": lambda s: str(s).upper()}) == "BAR"
    add_filter("temp", lambda x: "TEMP_" + str(x).upper())
    assert render("{{x|temp}}", {"x": "foo_bar"}) == "TEMP_FOO_BAR"
    remove_filter("temp")
    with pytest.raises(Exception):
        render("{{x|temp}}", {"x": "foo_bar"})


def test_inheritance_and_includes() -> None:
    assert preprocess_template_file("templates/inheritance/child-b.html") == """<html>
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
</html>"""
    assert preprocess_template_file("templates/inheritance/super-b.html") == """<html>
    <head></head>
    <body>
        {% block hello %}

            Hello 
         World
{% endblock %}
    </body>
</html>"""
    assert render_file("templates/inheritance/child-c.html", {}) == """<head><script src="my/C/script" /></head>

<body>my-body</body>
"""
    assert render_file("templates/inheritance/include-in-block.html", {}) == """<div>
hello
</div>
"""
    assert render_file("templates/child.html", {}) == "Base template.\n\n\t\n<p></p>\n\n\n"
    assert render_file("templates/child.html", {"content": "blah"}) == "Base template.\n\n\t\n<p>blah</p>\n\n\n"
    assert render_file("templates/include.html", {}) == "/page?name=foo - abc"
    assert render_file("templates/include.html", {"gridid": "xyz"}) == "/page?name=foo - xyz"
    assert render_file("templates/inheritance/include/another-grandparent.html", {}) == "foo bar baz default-value other-default-value"


def test_cache_controls() -> None:
    cache_off()
    assert render_file("templates/my-include.html", {"foo": "foo"}) == "main template foo body"
    cache_on()
    assert render_file("templates/my-include.html", {"foo": "bar"}) == "main template bar body"


def test_if_tags() -> None:
    assert render("{% if any foo bar baz %}hello{% endif %}", {"bar": "foo"}) == "hello"
    assert render("{% if not any foo bar baz %}hello{% endif %}", {}) == "hello"
    assert render("{% if all foo bar %}hello{% endif %}", {"foo": "foo", "bar": "bar"}) == "hello"
    assert render("{% if all foo bar %}hello{% endif %}", {"foo": "foo"}) == ""
    assert render("{% if v > 2 %}bigger{% endif %}", {"v": 3}) == "bigger"
    assert render("{% if v > -2 %}bigger{% endif %}", {"v": -3}) == ""
    assert render("{% if 5 = v %}equal{% endif %}", {"v": 5}) == "equal"
    assert render('{% if fruit = "banana"%}for monkey{% else %}not banana{% endif %}', {"fruit": "banana"}) == "for monkey"
    assert render("{% if foo %}foo{% elif bar %}bar{% elif baz %}baz{% else %}else{% endif %}", {"bar": True, "baz": True}) == "bar"


def test_compare_tags() -> None:
    assert render('{% ifequal foo|upper "FOO" %}yez{% endifequal %}', {"foo": "foo"}) == "yez"
    assert render('{% ifequal foo "foo" %}foo{% else %}no foo{% endifequal %}', {"foo": False}) == "no foo"
    assert render('{% ifunequal foo "bar" %}yez{% endifunequal %}', {"foo": "foo"}) == "yez"
    assert render('{% ifunequal foo "foo" %}yez{% endifunequal %}', {"foo": "foo"}) == ""


def test_for_tags() -> None:
    assert render("{%for x in foo.0%} {{x.id}} {%endfor%}", {"foo": [[{"id": "s"}, {"id": "a"}]]}) == " s  a "
    assert render("<ul>{% for athlete in athlete_list %}<li>{{ athlete.name }}</li>{% empty %}<li>Sorry, no athletes in this list.</li>{% endfor %}<ul>", {}) == "<ul><li>Sorry, no athletes in this list.</li><ul>"
    assert render("{% for x in foo.bar|sort %}{{x}}{% endfor %}", {"foo": {"bar": [1, 4, 3, 5]}}) == "1345"
    assert render("{% for x in foo.bar|sort|sort-reversed %}{{x}}{% endfor %}", {"foo": {"bar": [1, 4, 3, 5]}}) == "5431"
    assert render("{% for a,b,c in items %}{{a}},{{b}},{{c}};{% endfor %}", {"items": [[1, 2, "a", "b"], [3, 4]]}) == "1,2,a;3,4,;"
    assert render("{% for i in 3|range:1:2 %}i={{i}};{% endfor %}", {}) == "i=1;"
    assert render("{% for ele in foo %}{{ele}}-{{forloop.counter}}-{{forloop.counter0}}-{{forloop.revcounter}}-{{forloop.revcounter0}};{%endfor%}", {"foo": [1, 2, 3]}) == "1-1-0-2-3;2-2-1-1-2;3-3-2-0-1;"


def test_utility_tags() -> None:
    assert render("{% with total=business.employees|count %}{{ total }} employee{{ business.employees|pluralize }}{% endwith %}", {"business": {"employees": [0, 1, 2, 3, 4]}}) == "5 employees"
    assert render('{% with math="1+1=2" %}{{ math }}{% endwith %}', {}) == "1+1=2"
    assert render("foo bar {% comment %} baz test {{x}} {% endcomment %} blah", {}) == "foo bar  blah"
    assert render("foo bar {# baz test {{x}} #} blah", {}) == "foo bar  blah"
    assert render("{% firstof var1 var2 var3 %}", {"var2": "x", "var3": "not me"}) == "x"
    assert render("{% verbatim %}{{if dying}}Still alive.{{/if}}{% endverbatim %}", {}) == "{{if dying}}Still alive.{{/if}}"
    assert render("{% safe %}{{foo|upper}}{% endsafe %}", {"foo": "<foo>"}) == "<FOO>"
    assert render("{% sum foo bar.baz \\1 %}", {"foo": 2, "bar": {"baz": 3}}) == "6"
    assert render('{% cycle "foo" "bar" %}{% cycle "foo" "bar" %}', {}) == '"foo""foo"'


def test_script_and_style_tags() -> None:
    assert render('{% script "/js/site.js" %}', {}) == '<script src="/js/site.js" type="application/javascript"></script>'
    assert render("{% script path|upper %}", {"selmer/context": "/myapp", "path": "/js/site.js"}) == '<script src="/myapp/JS/SITE.JS" type="application/javascript"></script>'
    assert render('{% script "/js/site.js" async=1 defer=1 type="module" %}', {}) == '<script async defer src="/js/site.js" type="module"></script>'
    assert render("{% style path %}", {"selmer/context": "/myapp", "path": "/css/screen.css"}) == '<link href="/myapp/css/screen.css" rel="stylesheet" type="text/css" />'


def test_filters() -> None:
    assert render("{{f|upper}}", {"f": "foo"}) == "FOO"
    assert render('{{"FOObar"|lower}}', {}) == "foobar"
    assert render('{{f|subs:0:3:" ..."}}', {"f": "FOO BAR"}) == "FOO ..."
    assert render("{{seed|add:1:2:3}}", {"seed": 34}) == "40"
    assert render("{{foo|multiply:3}}", {"foo": 3.33}) == "9.99"
    assert render("{{foo|divide:2}}", {"foo": 3}) == "1.5"
    assert render("{{foo|round}}", {"foo": 3.33333}) == "3"
    assert render('{{sequence|join:", "}}', {"sequence": [1, 2, 3, 4]}) == "1, 2, 3, 4"
    assert render('{{seq|drop:2|join:" "}}', {"seq": ["a", "b", "c", "d"]}) == "c d"
    assert render("{{seq|take:2}}", {"seq": [":dog", ":cat", ":bird"]}) == "[:dog :cat]"
    assert render("{{xs|empty?}}", {"xs": []}) == "true"
    assert render("{{foo|replace:foo:bar}}", {"foo": "foo test foo"}) == "bar test bar"
    assert render('{{f|hash:"md5"|upper}}', {"f": "foo"}) == "ACBD18DB4CC2F85CEDEF654FCCC4A4D8"
    assert render("{{data|json}}", {"data": {"foo": 27}}) == "{&quot;foo&quot;:27}"
    assert render("{{data|json|safe}}", {"data": {"foo": 27}}) == '{"foo":27}'


def test_specialized_filters() -> None:
    assert render("{{e|email}}", {"e": "foo@bar.baz"}) == "<a href='mailto:foo@bar.baz'>foo@bar.baz</a>"
    assert render("{{p|phone:44}}", {"p": "01234 567890"}) == "<a href='tel:+44-1234-567890'>01234 567890</a>"
    assert render("{{f|pluralize:y:ies}}", {"f": [1, 2, 3]}) == "ies"
    assert render("{{f|pluralize:y:ies}}", {"f": [1]}) == "y"
    assert render("{{foo|between?:2:4}}", {"foo": 3}) == "true"
    assert render("{{value|remove-tags:b:span}}", {"value": "<b><span>foobar</span></b>"}) == "foobar"
    assert render("{{name|default:@v|count}}", {"v": [1, 2, 3, 4]}) == "4"
    assert render("{{name|default:@foo.bar.baz}}", {"foo": {"bar": {"baz": "quux"}}}) == "quux"


def test_escaping_controls() -> None:
    assert render('<tag>{{f}}</tag>', {"f": '<foo bar="baz">\\>'}) == "<tag>&lt;foo bar=&quot;baz&quot;&gt;\\&gt;</tag>"
    assert render("{{f}}", {"f": "&\"'<>"}) == "&amp;&quot;&#39;&lt;&gt;"
    assert render("{{f|safe}}", {"f": "<foo>"}) == "<foo>"
    turn_off_escaping()
    assert render("{{name}}", {"name": "I <3 ponies"}) == "I <3 ponies"
    turn_on_escaping()
    assert without_escaping(lambda: render("{{name}}", {"name": "I <3 ponies"})) == "I <3 ponies"
    turn_off_escaping()
    assert with_escaping(lambda: render("{{name}}", {"name": "I <3 ponies"})) == "I &lt;3 ponies"


def test_missing_values_and_introspection() -> None:
    assert render("{{missing}}", {}) == ""
    set_missing_value_formatter(lambda _tag, _ctx: "XXX", filter_missing_values=False)
    assert render("{{missing}}", {}) == "XXX"
    assert render("{{missing|count}}", {}) == "XXX"
    set_missing_value_formatter(lambda _tag, _ctx: "XXX", filter_missing_values=True)
    assert render("{{missing|count}}", {}) == "0"

    assert known_variables("{{name|capitalize}}") == {"name"}
    assert known_variables("{% if any foo bar baz %}hello{% endif %}") == {"foo", "bar", "baz"}
    assert known_variable_paths("{% for x in some-list.nested1 %}{{x.more.nested2}}{% endfor %}") == [["some-list", "nested1"]]


def test_resolve_arg_debug_and_compiled_template() -> None:
    assert resolve_arg("{{variable}}", {"variable": "John"}) == "John"
    assert resolve_arg("Hello {{variable|upper}}!", {"variable": "John"}) == "Hello JOHN!"
    assert resolve_arg('{% if variable = "John" %}Mr {{variable}}{% endif %}', {"variable": "John"}) == "Mr John"
    assert resolve_arg('"Hello John!"', {}) == "Hello John!"

    assert "debug-value" in render("{% debug %}", {"debug-value": 1})
    assert "&lt;pre&gt;" in basic_edn_to_html({"a": "<pre>"})

    template = parse_input("<ul>{% for item in items %}<li>{{item}}</li>{% endfor %}</ul>")
    assert render_template(template, {"items": [0, 1, 2]}) == "<ul><li>0</li><li>1</li><li>2</li></ul>"


def test_validation_can_be_disabled() -> None:
    validate_off()
    assert "{%=file.name%}" in render_file("templates/verbatim.html", {})
