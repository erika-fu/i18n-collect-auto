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

Standalone HTML uses the parse5 adapter. Vue 2 templates use the owning project's
`vue-template-compiler`; Vue 3 templates use the owning project's
`@vue/compiler-sfc` and `@vue/compiler-dom`. Compiler selection starts at the
template resource, finds its nearest owning Vue installation, and selects the
adapter from that Vue major. An explicit loader option may override major-version
selection for unusual package layouts.

The collector package does not bundle a Vue runtime or production Vue compiler.
Vue compiler packages belong to the application so Vue 2 can enforce an exact
`vue-template-compiler` match and monorepos can host Vue 2 and Vue 3 applications
at the same time. The package keeps compiler packages only as development
dependencies for its adapter tests.

Only HTML Vue template blocks are supported. Missing template blocks and template
blocks using a language such as Pug produce no template entries; the collector
does not invoke preprocessors. Compiler-generated render functions are not
extraction input. JavaScript expressions found in source templates continue
through the shared Babel expression collector.

Collection policy stays in the collector. Attribute allowlists, semantic kinds,
directives, context filters, localized-call recognition, and final entry shaping are
not responsibilities of parser adapters.

Complete-static-copy policy, runtime-multilingual policy, and source replacement
remain on their existing parsing paths. Moving those consumers to Template IR is
deferred until their separate migration work.

## Alternatives considered

- Keep parsing Vue templates with parse5 and custom scanners. This preserved one
  parser dependency but duplicated Vue syntax handling and could not make Vue 3 a
  compiler-backed integration.
- Bundle one Vue compiler version with the collector. This simplified resolution
  but would parse with a compiler that can differ from the application's Vue
  version and would not support mixed-version monorepos correctly.
- Infer the Vue version from vue-loader. Loader version is an indirect signal and
  can disagree with the Vue installation that owns the resource.
- Collect from generated render functions. Generated code loses the original
  template structure and trustworthy source ranges, and would change collection
  eligibility.
- Expose compiler AST nodes to the collector. This would couple shared policy and
  the public surface to incompatible compiler-specific node shapes.

## Consequences

- Parser changes are isolated from collection policy and public package interfaces.
- Vue 2 and Vue 3 equivalent templates can be compared through the same normalized
  regions and final collection entries.
- The IR carries source-offset mappings because decoded entities and CRLF input must
  still report ranges in the original source.
- parse5 remains a direct dependency for standalone HTML.
- Applications must install the compiler packages appropriate for their Vue major;
  missing or incompatible packages fail with resource and owning-project context.
- Existing Vue 2 and standalone HTML values, semantic kinds, ranges, ordering,
  diagnostics, and formal output bytes remain compatibility constraints. JavaScript
  and CSS extraction are unaffected.
