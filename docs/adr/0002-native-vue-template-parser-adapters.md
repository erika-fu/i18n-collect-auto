# ADR-0002: Native Vue template parser adapters

## Status

Accepted

## Context

The HTML extractor historically parsed both standalone HTML and Vue templates with
parse5. Vue syntax then required custom handling for single-file component blocks,
interpolations, bindings, and JavaScript expression boundaries. Moving Vue templates
to their version-specific compilers must not expose compiler AST nodes or change the
public extractor contract, collection policy, source ranges, ordering, diagnostics,
or localized-call metadata.

## Decision

`extractHtml({ source, resource, config })` remains the public collection boundary.
It consumes an internal Template IR through the `parseTemplate` adapter seam.

The Template IR contains parser-neutral constructs, comments, text and attribute
regions, expression regions, construct ownership, original half-open source ranges,
decoded-to-source offset mappings, and warnings. It does not contain parse5, Vue 2,
or Vue 3 node types.

Standalone HTML continues to use the parse5 adapter. Vue templates also use that
adapter during this prefactor. Later changes will select native Vue 2 and Vue 3
compiler adapters behind the same seam without changing the collector interface or
collection output schema.

Collection policy stays in the collector. Attribute allowlists, semantic kinds,
directives, context filters, localized-call recognition, and final entry shaping are
not responsibilities of parser adapters.

## Consequences

- Parser changes are isolated from collection policy and public package interfaces.
- Native Vue compiler adapters can be added incrementally and compared against the
  characterization suite.
- The IR carries source-offset mappings because decoded entities and CRLF input must
  still report ranges in the original source.
- parse5 remains a direct dependency for standalone HTML.
