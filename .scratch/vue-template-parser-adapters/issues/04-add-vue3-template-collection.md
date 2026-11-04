# 04: Add Vue 3 template collection through native compiler adapters

**What to build:** Add first-class Vue 3 SFC/template collection using the owning project's `@vue/compiler-sfc` and `@vue/compiler-dom`, normalized into the same Template IR and collection contract as Vue 2.

**Blocked by:** 01: Establish the Template Parser Adapter seam; 02: Resolve project-local Vue compilers.

**Status:** ready-for-agent

## Context

Vue 3 is becoming a formally supported webpack integration, not an experimental parser fixture. Vue 3 compiler AST details must remain confined to the adapter. The shared collector must receive the same normalized concepts it receives from Vue 2 and standalone HTML.

Before implementation, read the repository agent instructions, domain glossary, Template Parser Adapter ticket, compiler-resolution ticket, existing template extraction behavior, and current Vue 3 replacement fixtures for representative syntax.

## Decisions already made

- Use project-local `@vue/compiler-sfc` to parse the SFC and project-local `@vue/compiler-dom` to parse HTML templates.
- Never collect from generated render functions.
- Convert Vue 3 nodes and locations into the common Template IR.
- Preserve existing semantic kinds and collection entry schema.
- Continue using the shared Babel expression collector for static JavaScript fragments and localized calls when appropriate.
- Skip non-HTML template languages without failure.

## Acceptance criteria

- [ ] Vue 3 template text and static user-facing attributes are collected with trustworthy original-file source ranges.
- [ ] Vue 3 dynamic user-facing attributes and interpolations collect the same eligible static string and template-literal fragments as Vue 2.
- [ ] Existing `t()`, `$t()`, and supported instance localization calls retain key, representation, parameter kind, and parameter-name metadata.
- [ ] HTML exclusion and key directives have the same next-fragment semantics as Vue 2.
- [ ] Vue 2 and Vue 3 equivalent-template fixtures produce semantically equivalent normalized regions and final collection entries.
- [ ] Coverage includes CRLF, entities, astral characters, nested template elements, comments, malformed expressions, compiler diagnostics, and missing template blocks.
- [ ] Non-HTML template languages return no entries without attempting a preprocessor.
- [ ] Existing package tests remain green.

## Non-goals

- Do not add the full Vue 3 demo in this ticket.
- Do not modify policy checks or source replacement.
- Do not expose Vue 3 compiler AST nodes outside the adapter.
- Do not support Pug or other template preprocessors.

## Validation

- Run focused Vue 3 adapter and cross-version equivalence tests.
- Run the complete package test suite.
- Confirm errors are reported against original SFC positions rather than compiler-generated code.

