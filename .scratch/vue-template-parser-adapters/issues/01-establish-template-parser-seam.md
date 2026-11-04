# 01: Establish the Template Parser Adapter seam

**What to build:** Introduce an internal Template Parser Adapter seam and normalized Template IR while preserving every existing Vue 2 and standalone HTML collection result. This is the prefactor that makes native Vue compiler adapters possible without exposing parser-specific ASTs to the collector.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## Context

The current HTML extractor uses parse5 for standalone HTML and Vue templates, then compensates for missing Vue semantics with custom SFC, interpolation, JavaScript-boundary, and binding scanners. The agreed design keeps parse5 for standalone HTML but moves Vue templates to version-specific native compiler adapters.

The public extractor interface and collection entry contract must remain unchanged. Parser-specific nodes from parse5, Vue 2, or Vue 3 must never become part of the public interface.

Before implementation, read the repository agent instructions, domain glossary, collection architecture, existing template extractor tests, and the existing architecture decision record.

## Decisions already made

- Keep `extractHtml({ source, resource, config }) -> { entries, warnings }` stable.
- Introduce an internal normalized Template IR for text regions, static attributes, expression regions, comments/directives, construct ownership, warnings, and original source ranges.
- Keep semantic kinds, source-range conventions, output ordering, directive semantics, and localized-call metadata unchanged.
- Keep standalone HTML on parse5.
- Do not expose Template IR as a package-level public interface.
- Do not change collection policy while introducing the seam.

## Acceptance criteria

- [ ] Existing standalone HTML and Vue 2 inputs flow through the new internal seam without changing externally observable collection results.
- [ ] The normalized representation is independent of parse5, Vue 2 compiler, and Vue 3 compiler node types.
- [ ] Characterization tests lock value, semantic kind, project path, half-open source range, ordering, explicit key, localized-call representation, parameter metadata, warnings, and failures.
- [ ] Characterization coverage includes HTML entities, CRLF input, astral characters, nested template elements, comments, exclusion directives, key directives, dynamic bindings, interpolation strings, template literals, and existing localization calls.
- [ ] Existing package tests remain green.
- [ ] An ADR records the decision to use native Vue compiler adapters for Vue templates while retaining parse5 for standalone HTML.

## Non-goals

- Do not switch Vue 2 collection to `vue-template-compiler` yet.
- Do not add Vue 3 support yet.
- Do not migrate complete-static-copy policy, runtime-multilingual policy, or source replacement.
- Do not change JavaScript or CSS extraction.
- Do not add support for Pug or other template preprocessors.

## Validation

- Run the package test suite.
- Compare representative collection snapshots before and after the prefactor.
- Confirm no public package entry point or collection output schema changes.

