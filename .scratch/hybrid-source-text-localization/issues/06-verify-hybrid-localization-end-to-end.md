# 06: Verify the hybrid localization workflow end to end

**What to build:** The repository demonstrates and verifies the complete hybrid workflow: complete static Chinese copy receives durable automatic identity, explicit dynamic and structured messages translate correctly, runtime-multilingual boundaries prevent direct literals, source changes trigger review, and the quality gate prevents regressions.

**Blocked by:** 01: Add an explicit message manifest and dynamic-call catalog lifecycle; 02: Enforce complete static copy with an incremental baseline; 03: Enforce explicit localization for structured and shared messages; 04: Add runtime-multilingual feature boundaries; 05: Add the hybrid-localization quality gate.

**Status:** ready-for-agent

- [ ] Add an end-to-end workflow test that exercises collection, explicit messages, translation review, automatic-key stability, runtime rendering, and policy enforcement together.
- [ ] Verify that editing complete static copy preserves its automatic key when identity remains unambiguous, and that editing an explicit canonical message retains its key while marking target translations for review.
- [ ] Verify the documented fail-closed recovery path for identity ambiguity alongside the new authoring policy, without weakening existing catalog lifecycle guarantees.
- [ ] Refresh and validate all committed Vue and React demo catalogs and metadata; run the package test suite and both demo builds, recording their actual results.
- [ ] Reconcile the README, collection troubleshooting and architecture records, the hybrid-localization ADR, domain vocabulary, and lesson navigation/content so none imply that dynamic fragments are independently translatable or that collection alone enables runtime locale switching.
- [ ] Add or refresh a final lesson exercise that lets a reader classify automatic complete static copy, manifest-backed explicit messages, and forbidden source shapes.
