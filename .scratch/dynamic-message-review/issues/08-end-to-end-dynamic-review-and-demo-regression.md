# 08: Add end-to-end dynamic review and demo regression coverage

**What to build:** The regression suite protects the complete dynamic message review lifecycle and the refreshed demos: discovery, decisions, safe migration, collection publication, completeness, and runtime-facing artifacts stay aligned across supported workflows.

**Blocked by:** 04: Implement proven-safe review write migrations; 05: Evaluate dynamic candidates in localization completeness; 07: Refresh all demo localization artifacts through the new workflow.

**Status:** ready-for-agent

- [ ] End-to-end tests cover `collect` and `scan` producing equivalent candidate disposition semantics from shared decisions.
- [ ] Tests prove failed decision validation does not replace prior formal collection outputs.
- [ ] Tests cover the review command, safe write success and refusal paths, decision state transitions, and completeness policy results.
- [ ] The standard demo, React demo, and Vue 3 demo run their supported localization workflow and validate regenerated artifacts and runtime/build behavior.
- [ ] The package test suite and relevant demo verification commands pass without relying on uncommitted generated artifacts.
