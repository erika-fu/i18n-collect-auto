# 07: Migrate template policy checks to Template IR

**What to build:** In the follow-up phase, make complete-static-copy and runtime-multilingual policy checks consume the shared Template IR so Vue 2 and Vue 3 policy semantics match collection semantics without maintaining a second parse5-based Vue interpretation.

**Blocked by:** 06: Complete cross-framework regression and documentation.

**Status:** ready-for-agent

## Context

The first phase intentionally changes collection only. Policy checks still contain their own template parsing and source-location logic. Leaving those implementations permanently separate risks disagreements where collection accepts or classifies a Vue construct differently from policy enforcement.

This ticket begins the second phase. It should reuse the existing parser adapters and normalized Template IR rather than adding another abstraction or exposing compiler ASTs.

Before implementation, read the repository agent instructions, domain glossary, policy definitions, the compiler-adapter ADR, the first-phase tickets, and policy regression tests.

## Decisions already made

- Collection remains the reference behavior for template parsing, source ranges, directives, user-facing attributes, and static-expression fragments.
- Standalone HTML remains parse5-backed through the shared HTML adapter.
- Vue 2 and Vue 3 policy checks use their native compiler adapters through Template IR.
- Policy meaning must not change merely because parsing is consolidated.

## Acceptance criteria

- [ ] Complete-static-copy checks consume normalized template regions instead of reparsing Vue templates through a separate parse5 path.
- [ ] Runtime-multilingual boundary checks consume the same normalized template regions and localized-call metadata used by collection.
- [ ] Existing policy violations, grandfathered baseline matching, source ranges, error messages, and deterministic ordering remain compatible.
- [ ] Vue 2 and Vue 3 equivalent templates produce equivalent policy outcomes.
- [ ] Standalone HTML policy behavior remains unchanged.
- [ ] Tests cover directives, structured fragmentation, dynamic bindings, localized calls, source ranges, entities, CRLF, and boundary membership.
- [ ] The complete package test suite and all demo builds remain green.
- [ ] Architecture documentation no longer describes policy parsing as an independent Vue interpretation.

## Non-goals

- Do not migrate source replacement in this ticket.
- Do not delete parsing utilities that replacement still uses.
- Do not redefine complete static copy, structured messages, or runtime-multilingual boundaries.
- Do not add support for new template languages.

## Validation

- Run focused complete-static-copy and runtime-multilingual policy tests.
- Run the full package test suite.
- Run Vue 2 and Vue 3 demo builds and hybrid localization verification.
- Compare representative policy diagnostics before and after migration.

