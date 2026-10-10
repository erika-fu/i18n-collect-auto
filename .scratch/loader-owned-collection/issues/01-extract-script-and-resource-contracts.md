# 01: Extract the Script Collection Core and Establish Resource Identity

**What to build:** Extract the existing JavaScript/TypeScript text recognition logic from the webpack Loader adapter into an independently testable pure extractor, and establish contracts for resource descriptions, Resource identity, path filtering, and source coordinates that will later be shared by HTML/CSS. At the end of this Ticket, existing Script collection must still work through the public `myloader`, the Loader must pass webpack data through unchanged, and the output schema must remain compatible. This Ticket does not change the Plugin's current scanning responsibility; that will be completed in Ticket 02.

Before starting, you MUST read the root-level `CONTEXT.md`, `docs/collection-architecture.md`, and `docs/collection.md`. Follow the confirmed design in `docs/collection-architecture.md`; the requirements for this Ticket are also listed in full below and do not depend on prior conversation.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Required behavior

- The public entry point MUST remain `i18n-collect/myloader`; do not expose multiple webpack loaders.
- Internally, there MUST be at least three clearly separated responsibilities: the webpack adapter, resource classification/identity/filtering, and the pure Script extractor. Do not create a parser registry or a general-purpose compiler framework.
- The Script extractor MUST preserve the existing Babel behavior:
  - Ordinary strings use `script-string`;
  - Each static segment of a template literal uses `template-literal`;
  - Interpolation expressions are not concatenated into the template literal value, but strings that independently occur within an expression are still processed according to Babel traversal semantics;
  - Import/export module specifiers are ignored;
  - Expressions are not executed, and variables are not evaluated;
  - Preserve the existing JavaScript source range behavior; do not use this Ticket to change it to a content-only range.
- Chinese eligibility detection MUST change to Unicode Han Script. If a static fragment contains at least one Han character, retain the complete decoded value, including punctuation, digits, spaces, and other characters; do not collect fragments containing only punctuation, only whitespace, or only English text.
- Establish a stable Resource identity that includes only fields affecting collection semantics. The canonical form MUST cover at least standalone script, Vue script, Vue template, Vue style index/lang, and standalone HTML/CSS. Paths MUST be project-relative, query-free, and use `/` as the separator; do not include non-semantic Vue fields such as `id`, `scoped`, or `prod` in the identity.
- Vue style identity MUST distinguish the style index and effective lang. Normalize omitted languages to script=`js`, template=`html`, and style=`css`.
- Change `include`/`exclude` to project-relative file or directory boundary matching without introducing globs: the pattern `src/foo` matches only itself and `src/foo/**`, and MUST NOT match `src/foobar`. Apply include first; exclude has the final veto. Ignore the resource query when matching.
- Configuration validation MUST reject absolute paths, `..` paths that escape the root, empty/root-only filters, and entries that are duplicates after normalization.
- Remove the configuration field `htmlEntries`; narrow the default value of `styleExtensions` to `['.css']`. Loader-owned fields are `include`, `exclude`, `attributeAllowlist`, and `styleExtensions`; Plugin-owned fields remain `outputPath` and `sourceMapFilename`. Explicit options MUST NOT override fields across responsibility boundaries.
- Narrow the webpack peer dependency to webpack 5. If `loader-utils` is no longer used, switch to webpack 5's options API and remove the dependency.
- The Loader MUST use the callback to pass through `source`, the existing `sourceMap`, and `meta` unchanged. It MUST NOT modify source bytes or discard upstream data.
- Preserve compatibility with the current MD5 runtime dictionary, source-map version 1 envelope, Semantic kind names, and deterministic sorting.

## Source coordinate contract

- Lines are 1-based; columns are 0-based; columns are measured in UTF-16 code units; ranges are half-open/end-exclusive; paths are project-relative and use `/`.
- The public offset-to-position utility MUST count by JavaScript string index, not by Unicode code point.
- The current delimiter behavior of JavaScript ranges MUST remain unchanged.

## Non-goals

- Do not remove the Plugin's directory scanning; the switch to a Loader-only pipeline occurs in Ticket 02.
- Do not implement production HTML or CSS extractors.
- Do not implement sessions, module metadata, stale eviction, or failed-round transactions.
- Do not implement Sass/Less/Stylus, Vite/Rollup, source rewriting, or `no-i18n-auto`.
- Do not upgrade the public collection schema.

## Acceptance criteria

- [ ] Script extraction can be called as a pure function without reading files, accessing webpack, writing to the Store, or writing output files.
- [ ] Ordinary strings, template literals, import/export exclusion, and the existing JS ranges have regression tests and remain compatible.
- [ ] Han Script tests cover basic Han characters, extension characters, mixed punctuation/digits, punctuation-only text, and English-only text.
- [ ] Resource identity tests cover standalone script/HTML/CSS and Vue script/template/multiple style indexes/langs, and prove that irrelevant query fields do not change identity.
- [ ] Include/exclude tests prove directory-boundary behavior, include-then-exclude behavior, query ignoring, path normalization, and invalid-configuration behavior.
- [ ] Coordinate tests cover LF, CRLF, and an astral character before a fragment, and verify 1-based lines and 0-based UTF-16 columns.
- [ ] Loader tests prove that string/Buffer content, source maps, and meta are passed through unchanged.
- [ ] `htmlEntries` has been removed from defaults, validation, allowed options, and related tests; the default value of `styleExtensions` is `.css`.
- [ ] The Package explicitly supports only webpack 5, and dependencies and the lockfile match actual direct usage.
- [ ] The existing runtime dictionary and outer source-map v1 structure have not changed.
- [ ] Package tests pass; if the repository contains old tests that conflict with the not-yet-implemented Ticket 02, they should be adjusted to verify the current transitional contract without deleting critical regression coverage.
