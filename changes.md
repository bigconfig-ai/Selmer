# Changes

## 1.13.1.post0

- Ported Selmer from Clojure to Python 3.12.
- Added a `pyproject.toml` package managed with `uv`.
- Added a dependency-free runtime implementation for:
  - parser and renderer
  - filters
  - tags
  - includes and template inheritance
  - validation
  - cache controls
  - escaping controls
  - missing-value formatting
  - custom tags and filters
- Added type hints and `py.typed`.
- Converted the test suite to pytest.
- Updated README, docs, package metadata, and CI for Python/uv.
