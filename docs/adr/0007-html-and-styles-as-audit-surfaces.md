# Standalone HTML and styles as audit surfaces

## Status

Accepted. Supersedes ADR-0003's decision to collect style-generated content into the runtime localization catalog, and supersedes earlier collection architecture that treated standalone HTML as cataloged runtime copy. ADR-0003's original-source parsing constraint remains useful for accurate audit locations and is not reopened here.

## Decision

Standalone HTML and styles are Chinese source audit surfaces until an adapter can make their messages runtime-localizable. Audit findings never receive localization keys and never enter source or target catalogs. Build and source replacement planners do not consume these findings.

An audit finding becomes accepted only when it is migrated to a runtime-localizable surface, handled by a real adapter that makes it runtime-localizable, or suppressed by an adjacent directive that contains a non-empty reason. Unresolved proven findings and conservative preprocessor `needs-review` findings prevent project localization completeness. Intentionally ignored findings remain visible with their reason and do not block completeness.

Standard CSS audit uses structural parsing of author-written source for `content` strings. SCSS, indented Sass, Less, and Stylus audit uses lightweight source scanning that does not execute imports, variables, functions, mixins, or interpolation; those candidates are reported as `needs-review` rather than proven CSS generated content. Full preprocessor Style IR collection remains a legacy webpack-collect path until contracted elsewhere.

## Considered options

- **Keep HTML and CSS in the runtime catalog without a runtime adapter:** rejected because catalog entries would imply build or source replacement can localize them when no supported `t` / `$t` path exists.
- **Leave HTML and CSS invisible until adapters exist:** rejected because Chinese would remain in production surfaces without a completeness signal.
