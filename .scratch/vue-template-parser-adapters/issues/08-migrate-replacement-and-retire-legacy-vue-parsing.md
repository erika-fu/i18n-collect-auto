# 08: Migrate source replacement and retire legacy Vue parsing

**What to build:** Complete the follow-up phase by making Vue 2 and Vue 3 source replacement consume shared Template IR, then remove legacy Vue-specific parse5 scanners and duplicated template location logic that no remaining caller needs.

**Blocked by:** 07: Migrate template policy checks to Template IR.

**Status:** ready-for-agent

## Context

After collection and policy checks use Template IR, source replacement is the final consumer that may still depend on an independent Vue template interpretation. Replacement is safety-critical because incorrect ranges can rewrite the wrong source. Migration must therefore preserve preview, skip, write, rollback, and already-localized-call behavior before legacy code is removed.

Before implementation, read the repository agent instructions, domain glossary, replacement adapter definitions, replacement workflow documentation, compiler-adapter ADR, preceding tickets, and migration workflow tests.

## Decisions already made

- Vue 2 and Vue 3 replacement share parser adapters and Template IR but retain their distinct runtime call-shape adapters.
- Collection, policy checks, and replacement must agree on occurrence identity and original source range.
- Standalone HTML remains outside replacement scope and remains parse5-backed for collection and policy where applicable.
- Legacy Vue parsing code may be deleted only after repository-wide searches prove that no supported path depends on it.

## Acceptance criteria

- [ ] Vue 2 replacement preview and write behavior use Template IR source ranges and preserve existing `this.$t` integration rules.
- [ ] Vue 3 replacement preview and write behavior use Template IR source ranges and preserve script-setup and Options API integration rules.
- [ ] Already localized calls remain idempotent and are never nested.
- [ ] Skip reasons, strict-mode failures, keyed catalog updates, replacement metadata, rollback behavior, and deterministic output remain compatible.
- [ ] Collection occurrence identities and replacement target ranges agree for representative Vue 2 and Vue 3 templates.
- [ ] Migration workflow tests cover preview, committed writes, repeated runs, failure rollback, directives, entities, CRLF, dynamic attributes, and interpolation fragments.
- [ ] Obsolete Vue-specific parse5 scanners and duplicated location-mapping code are removed only after all callers migrate.
- [ ] parse5 remains a direct dependency if standalone HTML or other supported modules still require it.
- [ ] The package test suite, all demo builds, and hybrid localization verification pass.
- [ ] Documentation clearly distinguishes the shared template parser layer from Vue 2 and Vue 3 runtime replacement adapters.

## Non-goals

- Do not add standalone HTML replacement.
- Do not change runtime localization integration requirements.
- Do not add Pug or other template preprocessors.
- Do not remove parse5 from unrelated standalone HTML implementations.

## Validation

- Run focused replacement and migration workflow tests.
- Run the complete package test suite.
- Build Vue 2, Vue 3, and React demos.
- Run hybrid localization verification.
- Search for and justify every remaining direct Vue-template parse5 usage before deleting legacy helpers.

