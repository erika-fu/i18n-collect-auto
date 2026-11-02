# 04: Add runtime-multilingual feature boundaries

**What to build:** A project can declare a feature or route as runtime-multilingual. All user-facing copy inside that boundary must use explicit localization and can render in target locales at runtime, while Chinese-first areas outside the boundary retain automatic collection for complete static copy.

**Blocked by:** 01: Add an explicit message manifest and dynamic-call catalog lifecycle; 02: Enforce complete static copy with an incremental baseline; 03: Enforce explicit localization for structured and shared messages.

**Status:** ready-for-agent

- [ ] Define a declarative, version-controlled way to identify runtime-multilingual feature or route boundaries and validate its configuration.
- [ ] Make the policy checker reject direct user-facing source text inside a declared boundary while retaining the existing automatic-collection behavior outside it.
- [ ] Specify and test boundary inheritance, nesting, and exclusions so a developer can predict which source is subject to the explicit-localization requirement.
- [ ] Demonstrate the boundary in both Vue and React demos: target-locale rendering succeeds for the multilingual scenario, and a direct literal within that boundary is rejected by validation.
- [ ] Add focused configuration, policy, collection, and runtime/demo regressions, then refresh committed catalog and metadata artifacts.
- [ ] Update documentation and lessons to make clear that being collected is not equivalent to being able to switch languages at runtime.
