# Changes

## 1.13.1-ts.0

- Ported Selmer from Clojure to TypeScript.
- Added an ESM Node.js package with TypeScript declarations.
- Added dependency-free runtime implementation for:
  - parser and renderer
  - filters
  - tags
  - includes and template inheritance
  - validation
  - cache controls
  - escaping controls
  - missing-value formatting
  - custom tags and filters
- Converted the test suite to Vitest.
- Updated README, docs, package metadata, and CI for Node.js/npm.
