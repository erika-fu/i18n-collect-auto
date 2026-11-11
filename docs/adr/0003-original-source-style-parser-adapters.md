# ADR-0003: Original-source style parser adapters

## Status

Superseded by ADR-0007 for treating style findings as runtime catalog messages. Accepted for original-source parsing of author-written styles (not compiled CSS) when locating audit findings.

## Context

CSS generated content can be authored in standard CSS or in a style language such
as SCSS, indented Sass, Less, or Stylus. Webpack and style preprocessors can turn
those sources into CSS, but generated CSS no longer provides a trustworthy mapping
to the author-written declaration and string. It can also contain declarations
created by variables, interpolation, mixins, functions, or imports that were never
directly written at the reported source location.

Collection needs one stable policy for semantic kinds, directives, string decoding,
eligibility, result shaping, and half-open UTF-16 source ranges. Parser-specific AST
shapes must not duplicate or redefine that policy.

## Decision

Style collection reads the original author-written style source. Each supported
language has a parser adapter that converts its parser AST into a language-neutral
Style IR. The IR contains source declarations, block comments, and value tokens
anchored by offsets in the original source. Value tokens distinguish directly
authored static strings from computed values.

The shared style collector consumes Style IR. It owns `content` declaration
selection, block-comment directive association, CSS-compatible string decoding,
Chinese-text eligibility, `css-generated-content` result shaping, and conversion
of original offsets to half-open UTF-16 source ranges. Parser adapters do not emit
collection entries.

Only directly authored static string tokens are eligible. Collection does not
evaluate variables, interpolation, mixins, functions, imports, or other computed
values. A static string remains eligible when it appears beside a function or
another computed token because its own value and source range are still known.

Webpack loader output, compiled CSS, source maps from preprocessors, and
preprocessor execution are not style collection inputs. Vue style blocks are
located in the original single-file component, and adapter offsets remain anchored
to that file.

## Alternatives considered

- **Collect from compiled CSS:** rejected because compilation can create, merge, or
  rewrite values and cannot guarantee the original occurrence range.
- **Run preprocessors inside collection:** rejected because collection would execute
  project code and imports, depend on loader configuration, and collect computed
  output outside the complete-static-copy contract.
- **Let each language adapter produce collection entries:** rejected because
  directives, decoding, eligibility, and location behavior would drift between
  languages.
- **Parse every language as standard CSS:** rejected because accidental parser
  acceptance does not establish correct syntax, errors, or source-token semantics.

## Consequences

- Standard CSS behavior remains the compatibility baseline for style collection.
- SCSS, indented Sass, Less, and Stylus are supported source-style languages;
  `styl` is an alias for Stylus.
- New style languages require a source parser adapter that emits Style IR and marks
  directly authored static strings explicitly.
- Parser ASTs and dependencies stay behind adapter boundaries.
- Computed style output requires an explicit localization approach; it is not
  automatically collected.
- A syntax error in a supported source-style language is a collection failure that
  reports an author-source location and preserves the previous formal outputs.
- Unknown or deliberately unsupported style languages retain the warning and empty
  snapshot behavior; they are not parsed as standard CSS.
