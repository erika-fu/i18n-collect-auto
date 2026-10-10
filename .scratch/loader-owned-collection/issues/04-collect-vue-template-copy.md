# 04: Collect HTML copy from Vue templates

**What to build:** Use the shared `myloader` and a pure HTML extractor to collect user-visible HTML text, allowlisted attributes, static fragments from Vue bindings, and copy from interpolation expressions in Vue templates, while leaving Vue compilation output unchanged and mapping every location precisely to the original `.vue` file.

Before starting, you MUST read the root `CONTEXT.md`, `docs/collection-architecture.md`, `docs/collection.md`, and the implementations and tests from Tickets 01–03. The semantics listed here constitute the complete implementation contract for this Ticket.

**Blocked by:** 03: Ensure consistency across incremental builds and failed rounds

**Status:** ready-for-agent

## Parser and module boundary

- Declare `parse5` as a direct dependency of the package; do not rely on a transitive dependency incidentally installed by the demo or another package.
- Add a pure HTML extractor: it accepts source code, a normalized resource descriptor, and config, and returns entries/warnings; it MUST NOT access webpack, the session, output files, or global state.
- Use HTML fragment mode for Vue templates.
- Vue `type=template` passes through the same shared `myloader` and produces a distinct template Resource identity.
- Replace the transitional path established in Ticket 02 for compatibility with existing interpolation collection with the proper HTML extractor.

## HTML text semantics

- Each HTML text node independently forms a candidate fragment; do not merge across tags, siblings, or descendants.
- Ignore text nodes consisting entirely of whitespace.
- Remove leading and trailing line breaks and indentation introduced by formatting.
- Preserve meaningful internal spaces and line breaks.
- Preserve inline edge spaces on lines without line breaks by default, to avoid removing semantic spacing around adjacent inline elements.
- MUST NOT unconditionally apply ordinary `trim()` to every text node; fixtures MUST establish the rules for block indentation and inline spacing.
- Collect a fragment only when its final decoded value contains Unicode Han Script, but preserve the entire fragment.
- Use `html-text` for ordinary text in Vue templates.

## Character references

- Use the decoded value of an HTML character reference/entity for eligibility, MD5, and the runtime dictionary.
- The source range still covers the original source spelling. For example, when the value is the decoded `Saved successfully`, the range slice is still `Saved&nbsp;successfully`.
- When an entity changes the decoded length, MUST NOT infer the range from the decoded string; retain the original offsets during parsing/scanning.

## Static attributes

- Process only underlying attribute names in `attributeAllowlist`, which includes `title`, `placeholder`, `alt`, `aria-label`, and `value` by default.
- Support double-quoted, single-quoted, and unquoted static attributes, as well as legal whitespace around `=`.
- Use the decoded value for collection; the range covers only the original attribute-value content and excludes the attribute name, `=`, and HTML quote delimiters.
- Do not collect non-allowlisted attributes, event handlers, ordinary directives, or internal data attributes.
- Use `html-attribute` for static attributes in Vue templates.

## Dynamic Vue bindings

- Recognize `:name` and `v-bind:name`, normalize the underlying name, and then apply the allowlist. If `.prop`/`.sync` modifiers are supported, semantics-only modifier portions MUST first be removed and covered by tests.
- Parse the binding expression with Babel, but NEVER execute the expression or read variable values.
- Collect ordinary string literals in the expression and every static Han segment of template literals; do not collect the dynamic expressions themselves.
- Each static fragment becomes a separate entry, and its kind remains `html-attribute`.
- The range covers only the original fragment content, excluding the HTML attribute quotes and the inner JavaScript string/backtick delimiters.

## Vue interpolation

- Continue collecting Babel string literals and static template-literal segments inside `{{ ... }}` as `template-expression`.
- Do not change them to `html-text` or generate both kinds of location.
- Do not execute expressions or concatenate dynamic values into complete copy.
- MUST correctly handle `}}` characters that may occur inside an expression; MUST NOT continue using a simple regular expression that truncates at the first `}}`.

## Original `.vue` source coordinates

- Shared location contract: 1-based line, 0-based UTF-16 column, half-open range, and project-relative `/` path.
- vue-loader may remove template indentation, so inspecting only the transformed block input cannot reliably recover original columns.
- A Loader may read the `resourcePath` currently being processed solely to locate the template block specified by the query and recover original offsets; it MUST NOT scan directories or read other application resources. The Plugin still MUST NOT read source code.
- If vue-loader provides stable, tested original-offset metadata, prefer that metadata.
- Multiple blocks of the same type, external template sources, and cases that cannot be uniquely located MUST be handled; MUST NOT implicitly guess by “matching the first `<template>`.”

## Errors

- A Babel parse error in a Vue binding/interpolation MUST fail the collection round/build, and the error MUST include the project-relative path, template block, 1-based line, and 0-based UTF-16 column.
- `parse5` recovers from some nonstandard HTML, and valid Vue syntax may produce diagnostics. Establish a very small, fixture-proven set of ignored Vue-compatible diagnostics; other diagnostics that make nodes or locations untrustworthy SHOULD fail.
- A failed round MUST use the transaction from Ticket 03 and preserve the previous published output.

## Non-goals

- Do not collect standalone HTML; completed in Ticket 05.
- Do not collect CSS; completed in Ticket 06.
- Do not implement `no-i18n-auto`.
- Do not execute Vue expressions or perform complex constant folding.
- Do not modify Vue templates or generated code.

## Acceptance criteria

- [ ] Unit tests for the pure HTML extractor do not depend on webpack or the filesystem.
- [ ] Vue template text nodes are collected independently without merging across tags; explicit fixtures cover both formatting indentation and semantic inline spaces.
- [ ] Entities use decoded values and original source ranges, and MD5 is based on the decoded value.
- [ ] Allowlisted static attributes are collected correctly; non-allowlisted attributes do not appear.
- [ ] Dynamic bindings collect every static string/template fragment without executing dynamic portions and use `html-attribute`.
- [ ] Vue interpolation continues to use `template-expression` and handles `}}` inside strings/objects within expressions.
- [ ] All new ranges point into the original `.vue` file and cover CRLF, astral characters, entities, multiline cases, and indentation scenarios.
- [ ] Multiple Vue blocks or external block sources are not mislocated by “first tag” logic.
- [ ] Fatal HTML/expression errors include the path, block, and location and do not overwrite old output; verified Vue-compatible syntax does not falsely fail.
- [ ] Template Loader collection works in a real Vue webpack build, while Vue render results, source maps, and page behavior remain unchanged.
- [ ] The Plugin still does not read or parse application source code.
- [ ] Package tests and the demo production build pass.
