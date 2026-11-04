# 06: Complete cross-framework regression and documentation

**What to build:** Finish the first delivery phase by making Vue 2, Vue 3, standalone HTML, React, and formal localization verification pass together, and document the resulting support contract and architecture.

**Blocked by:** 03: Switch Vue 2 collection to the native compiler adapter; 05: Add a Vue 3 webpack collection demo.

**Status:** ready-for-agent

## Context

This ticket is the integration gate for the collection-parser migration. It should not introduce a new parser design. It should expose missing integration coverage, fix only issues caused by the migration, and leave the repository with repeatable root-level validation commands.

The architecture documentation currently describes Vue 2 as the only delivered Vue integration. That statement must be updated only after both Vue versions work end to end.

Before implementation, read the repository agent instructions, domain glossary, collection architecture, the new ADR, all preceding tickets, and existing root validation scripts.

## Decisions already made

- Vue 2 and Vue 3 are first-class Webpack 5 integrations.
- Existing Vue 2 and standalone HTML outputs are compatibility contracts.
- JavaScript and CSS extraction behavior must not change as a side effect.
- Policy checks and source replacement remain on their current parsing paths until later tickets.

## Acceptance criteria

- [ ] The complete package test suite passes.
- [ ] Vue 2, Vue 3, and React production demo builds pass.
- [ ] Hybrid localization verification passes.
- [ ] Root-level scripts make the Vue 3 build and full regression gate discoverable and repeatable.
- [ ] Existing Vue 2 and standalone HTML fixtures retain byte-stable formal outputs where stability is already required.
- [ ] Cross-version equivalence tests cover representative Vue 2 and Vue 3 templates.
- [ ] No compiler-specific AST type leaks into the shared collector interface or public package surface.
- [ ] Architecture documentation describes compiler selection, supported Vue versions, parse5's remaining standalone-HTML role, unsupported template languages, and the fact that render functions are not extraction input.
- [ ] The ADR accurately records alternatives, trade-offs, dependency strategy, compatibility constraints, and deferred policy/replacement migration.
- [ ] The repository contains no accidental generated build artifacts beyond its established tracked outputs.

## Non-goals

- Do not migrate complete-static-copy policy, runtime-multilingual policy, or source replacement in this ticket.
- Do not broaden supported template languages.
- Do not redefine collected-text eligibility.
- Do not fix unrelated pre-existing test or demo failures.

## Validation

- Run `npm test`.
- Run the Vue 2 production build.
- Run the Vue 3 production build.
- Run the React production build.
- Run `npm run verify`.
- Review the working tree for unintended generated files and unrelated changes.

