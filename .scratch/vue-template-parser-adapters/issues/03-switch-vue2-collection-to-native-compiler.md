# 03: Switch Vue 2 collection to the native compiler adapter

**What to build:** Make Vue 2 SFC/template collection use the owning project's `vue-template-compiler`, normalize its result into Template IR, and preserve the existing collection contract exactly.

**Blocked by:** 01: Establish the Template Parser Adapter seam; 02: Resolve project-local Vue compilers.

**Status:** ready-for-agent

## Context

Vue 2 templates are currently parsed as HTML and supplemented by custom interpolation and binding scanners. Replace that Vue-specific path with the Vue 2 compiler's SFC and template parsing capabilities. Standalone HTML must continue through the parse5 adapter.

This is a behavior-preserving parser replacement. Existing collection consumers, catalogs, source maps, replacement metadata, and semantic kinds must not observe a change.

Before implementation, read the repository agent instructions, domain glossary, Template Parser Adapter ticket, compiler-resolution ticket, current template extractor tests, and Vue 2 demo configuration.

## Decisions already made

- Parse the complete SFC with the project-local Vue 2 compiler and retain original-file source ranges.
- Normalize Vue 2 compiler output into the common Template IR rather than teaching the collector about Vue 2 AST nodes.
- Continue using Babel for JavaScript expressions inside interpolation and dynamic user-facing attributes when that is necessary to preserve existing string-fragment and localized-call behavior.
- Preserve the current attribute allowlist and directive semantics.
- Non-HTML template languages continue to produce no entries and no fatal error.
- Do not use generated render functions as collection input.

## Acceptance criteria

- [ ] Vue 2 text, static user-facing attributes, dynamic user-facing attributes, interpolations, template literal fragments, directives, and localized calls are collected through the native compiler adapter.
- [ ] Existing Vue 2 fixtures produce exactly the same values, semantic kinds, ordering, keys, localized-call metadata, warnings, and source ranges as before.
- [ ] Entity spelling, CRLF, astral characters, indentation, nested template elements, and comments retain trustworthy original-file ranges.
- [ ] Ambiguous, missing, external, and non-HTML template blocks retain the agreed behavior.
- [ ] Standalone HTML still uses parse5 and retains its current behavior.
- [ ] The old Vue-specific interpolation, binding, or SFC scanning path is no longer used for Vue 2 collection where the compiler adapter supersedes it.
- [ ] The Vue 2 demo production build succeeds and produces unchanged formal collection outputs.
- [ ] Existing package tests remain green.

## Non-goals

- Do not add Vue 3 support in this ticket.
- Do not modify source replacement or policy-check parsers.
- Do not change the public extractor interface or entry schema.
- Do not add template preprocessors.

## Validation

- Run focused Vue 2 template extraction tests.
- Run the package test suite.
- Build the Vue 2 demo in production mode.
- Compare committed or fixture-based collection outputs byte-for-byte where the repository already treats them as stable outputs.

