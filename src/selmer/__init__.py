from __future__ import annotations

from .filter_parser import (
    compile_filter_body,
    escape_html,
    escape_html_star,
    literal,
    parse_literal,
    split_value,
    strip_doublequotes,
)
from .filters import add_filter, add_filter_bang, call_filter, filters, get_filter, remove_filter, remove_filter_bang
from .middleware import handle_template_parsing_error, wrap_error_page
from .node import FunctionNode, TextNode
from .parser import (
    cache_off,
    cache_off_bang,
    cache_on,
    cache_on_bang,
    clear_cache,
    clear_cache_bang,
    known_variable_paths,
    known_variables,
    parse,
    parse_file,
    parse_input,
    parse_str,
    parse_string,
    render,
    render_file,
    render_template,
    resolve_arg,
    set_resource_path,
    set_resource_path_bang,
    templates,
)
from .safe import SAFE_CONTEXT_KEY, SafeValue, is_safe_value, safe, unwrap_safe
from .tags import (
    add_tag,
    add_tag_bang,
    basic_edn_to_html,
    closing_tags,
    expr_tags,
    remove_tag,
    remove_tag_bang,
    set_closing_tags,
    set_closing_tags_bang,
    tag_handler,
)
from .template_parser import preprocess_template, preprocess_template_file, preprocess_template_string
from .util import (
    assoc_in,
    clj_str,
    deprecated_key_lookup,
    get_accessor,
    get_custom_resource_path,
    get_in,
    reset_deprecated_key_warnings,
    reset_missing_value_formatter,
    set_custom_resource_path,
    set_custom_resource_path_bang,
    set_deprecation_warning_handler,
    set_missing_value_formatter,
    set_missing_value_formatter_bang,
    set_resource_loader,
    set_warn_on_deprecated_keys,
    turn_off_escaping,
    turn_off_escaping_bang,
    turn_on_escaping,
    turn_on_escaping_bang,
    with_escaping,
    without_escaping,
)
from .validator import SelmerValidationError, validate, validate_off, validate_off_bang, validate_on, validate_on_bang

__all__ = [name for name in globals() if not name.startswith("_")]
