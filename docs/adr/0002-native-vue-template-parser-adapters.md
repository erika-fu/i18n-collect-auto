# ADR-0002: Native Vue template parser adapters

## Status

Accepted for compiler-backed Template IR used by filesystem analysis and source replacement. Superseded by ADR-0010 for the Webpack `collect --replace` surface: that workflow analyzes and rewrites compiler-generated render-function JavaScript.

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

The Template IR contains parser-neutral constructs with element names and parent
relationships, comments, text and attribute regions, expression regions, construct
ownership, original half-open source ranges, decoded-to-source offset mappings, and
warnings. It does not contain parse5, Vue 2, or Vue 3 node types.

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
does not invoke preprocessors. Filesystem analysis and source replacement use
original template input. Webpack `collect --replace` is a separate path that
receives compiler-generated render functions and analyzes them as JavaScript
(ADR-0010). JavaScript expressions found in source templates continue through
the shared Babel expression collector.

Collection policy stays in the collector. Attribute allowlists, semantic kinds,
directives, context filters, localized-call recognition, and final entry shaping are
not responsibilities of parser adapters.

Complete-static-copy and runtime-multilingual policy checks consume the same Template
IR for Vue templates. Their script and style checks remain separate because Template
IR only models template content. Source replacement also consumes Template IR to
validate Vue template occurrence ranges and locate existing localization calls.
The `vue2` and `vue3` replacement adapters remain separate because they select
different runtime call shapes for script setup and Options API positions.

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
- Collection, policy checks, and source replacement agree on Vue template source
  ranges through one compiler-backed Template IR.
- Vue 2 and Vue 3 equivalent templates can be compared through the same normalized
  regions, policy diagnostics, and final collection entries.
- The IR carries source-offset mappings because decoded entities and CRLF input must
  still report ranges in the original source.
- parse5 remains a direct dependency for standalone HTML.
- Standalone HTML policy checks remain parse5-backed through the HTML adapter and
  keep their existing behavior.
- Applications must install the compiler packages appropriate for their Vue major;
  missing or incompatible packages fail with resource and owning-project context.
- Existing Vue 2 and standalone HTML values, semantic kinds, ranges, ordering,
  diagnostics, and formal output bytes remain compatibility constraints. JavaScript
  and CSS extraction are unaffected.
