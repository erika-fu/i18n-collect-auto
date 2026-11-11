# Vue replacement before template compilation

## Status

Accepted. Extends ADR-0002 and ADR-0004: Vue templates remain compiler-backed through Template IR, and the shared replacement planner still decides edits, but Vue build and source replacement must apply those edits to original template text and attributes before the Vue template compiler generates render functions.

## Decision

Vue runtime-localizable messages are rewritten in the original template (text nodes and supported user-facing attributes) before template compilation. Replacement never targets generated render functions or compiler output.

Build replacement therefore inserts `$t` (or the adapter's equivalent) early enough that Vue 2 static render functions and Vue 3 cached nodes remain correct when the runtime locale changes. Source replacement edits the same original template surfaces so repeated builds and locale switches stay consistent with the planner's decisions.

## Considered options

- **Replace inside generated render functions:** rejected because Vue static optimizations can freeze locale-specific strings into render output and break later locale changes.
- **Treat Vue like plain JavaScript string replacement after compilation:** rejected because template structure, attribute bindings, and compiler ownership would be lost.
