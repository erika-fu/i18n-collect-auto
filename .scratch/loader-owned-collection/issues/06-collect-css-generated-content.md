# 06: Collect Standard CSS Generated Content

**What to build:** Use the shared `myloader` and a pure CSS extractor to collect every static Chinese string fragment from `content` declarations in standalone CSS and Vue style blocks, record accurate original source ranges, and emit one clear warning for unsupported style preprocessors in the first version without misparsing them or failing.

Before starting, you MUST read the root `CONTEXT.md`, `docs/collection-architecture.md`, `docs/collection.md`, and the code and tests for Tickets 01–03. This Ticket can proceed in parallel with the HTML work in Tickets 04/05 and SHOULD NOT depend on their implementation.

**Blocked by:** 03: Ensure Consistency for Incremental Builds and Failed Rounds

**Status:** ready-for-agent

## Parser and integration boundary

- Declare `postcss` as a direct package dependency.
- Add a pure CSS extractor: it accepts source code, a normalized resource descriptor, and config, and returns entries/warnings; it does not access webpack, sessions, output files, or global state.
- Support standalone `.css`, Vue `<style>`, and `<style lang="css">`.
- Both standalone CSS and Vue styles pass through the same shared `myloader`.
- Vue style Resource identity MUST include the style index and effective lang. Multiple style blocks MUST NOT overwrite one another.
- The collector MUST see source suitable for original-range calculation before CSS transformation, while passing source/sourceMap/meta through unchanged to the subsequent style pipeline.

## Collection semantics

Traverse only declarations whose case-normalized property is exactly `content`, and collect every static single-quoted or double-quoted CSS string in the value.

For example:

```css
.a::before { content: "\5FC5\586B"; }
.b::after  { content: "\7B2C" counter(item) "\9879"; }
.c         { content: var(--label, "\9ED8\8BA4\6807\7B7E"); }
.d         { content: attr(data-label); }
.e         { --label: "\5185\90E8\6587\6848"; }
.f         { color: red; /* \4E2D\6587\6CE8\91CA */ }
```

Collect the decoded strings represented by `\5FC5\586B`, `\7B2C`, `\9879`, and `\9ED8\8BA4\6807\7B7E`; do not collect dynamic functions, custom property definitions, other declarations, selectors, or comments.

- `content` is not required to appear on a pseudo-element; process any declaration that meets the rule.
- Dynamic portions such as `attr()`, `counter()`, and `var()` are not executed; when a function contains a static string, including a fallback, it is still collected independently.
- Do not collect when the entire value is `none` or `normal`.
- Do not collect empty strings, whitespace-only strings, or strings without Han characters.
- When a string contains at least one Unicode Han Script character, retain the complete decoded fragment; for example, the decoded value represented by `\FF08\65B0\FF09` enters the result as a whole.
- The Semantic kind is fixed as `css-generated-content`.

## CSS string scanning and escapes

- PostCSS handles the declaration AST and syntax errors; a small, standards-oriented value string scanner may be used to locate quoted strings, avoiding the introduction of a general-purpose CSS value framework in this release.
- The scanner MUST correctly skip comments, track parentheses/function nesting, and handle single quotes, double quotes, and CSS escapes.
- Use the decoded CSS string value for Han detection, MD5, and the runtime dictionary.
- The source range covers the original string content, including the original spelling of escapes, but excludes quote delimiters.
- Source offsets MUST NOT be inferred from the decoded value's length; the scanner SHOULD return the decoded value together with the original `[startOffset, endOffset)`.
- Coordinates use 1-based lines, 0-based UTF-16 columns, and half-open ranges, and map back to the original standalone CSS or `.vue` file.

## Vue source mapping

- Vue style input may have undergone padding/transformation. If normal Loader input is insufficient to recover original columns, follow the architectural convention: the Loader may read only its current `resourcePath` and locate the original block using the query's style index/lang; it MUST NOT scan directories or read other business resources.
- Multiple style blocks, blocks with identical content, block deletion, and index changes MUST have integration coverage.

## Unsupported preprocessors

The first version does not support parsers for SCSS, Sass, Less, or Stylus.

- When a Vue style's effective lang is not `css`, or a standalone resource extension is configured but has no parser, do not attempt to parse it with standard PostCSS.
- Emit at most one clear warning per `compilation + Resource identity + warning code`.
- Still submit an empty replacement snapshot and count it as a valid Loader invocation.
- Do not fail the build.
- `styleExtensions` defaults to `.css` only; future dialect support MUST explicitly add a parser and tests.

## Errors

- A PostCSS syntax error in standard CSS MUST fail the current collection/build round.
- The error includes the project-relative path, style index/lang, 1-based line, and 0-based UTF-16 column.
- The failed round uses the Ticket 03 transaction and preserves the previous official output.

## Non-goals

- Do not parse SCSS, Sass, Less, or Stylus.
- Do not parse selectors, comments, or arbitrary CSS strings; process only `content`.
- Do not execute CSS variables, functions, counters, or attributes.
- Do not implement HTML, source rewriting, runtime translation, or `no-i18n-auto`.

## Acceptance criteria

- [ ] Pure CSS extractor unit tests do not depend on webpack or the file system.
- [ ] Standard CSS `content` strings from standalone CSS and Vue styles enter the Collection result with kind `css-generated-content`.
- [ ] Every static string around `counter()`, `attr()`, and `var()` or within fallbacks in mixed values is correctly collected independently.
- [ ] Empty/whitespace/no-Han strings, `none`, `normal`, non-content declarations, custom properties, selectors, and comments are not collected.
- [ ] CSS escapes use the decoded value/MD5, while the range slice preserves the original escape and excludes quotes.
- [ ] Ranges cover LF, CRLF, astral characters, multiline content, and original Vue block coordinates.
- [ ] Multiple Vue style indices/langs use independent identities; deleting one block evicts only that snapshot.
- [ ] SCSS/Sass/Less/Stylus emits at most one warning per identity per round, submits an empty snapshot, is not misparsed, and does not fail.
- [ ] A standard CSS syntax error fails the entire round and preserves the old output.
- [ ] The Loader transparently passes through style source, source maps, and meta, and the demo's CSS processing result remains unchanged.
- [ ] The Plugin does not read or parse CSS source code.
- [ ] Package tests and the demo production build pass.
