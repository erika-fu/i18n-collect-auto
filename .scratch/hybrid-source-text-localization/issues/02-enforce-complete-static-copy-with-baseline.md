# 02: Enforce complete static copy with an incremental baseline

**What to build:** The project can distinguish complete static copy that remains eligible for automatic collection from user-facing message construction that must use an explicit localization call. Existing policy violations can be captured in a committed baseline, while newly introduced violations and modified baseline violations fail with actionable diagnostics.

**Blocked by:** 01: Add an explicit message manifest and dynamic-call catalog lifecycle.

**Status:** ready-for-agent

- [ ] Define a machine-checkable policy for complete static copy: a whole static literal may be automatically collected, while interpolation, concatenation, conditional construction, and formatting cannot be treated as independently translatable fragments.
- [ ] Provide a local validation entry point that reports the policy reason and the affected source location, rather than treating policy violations as generic collection omissions.
- [ ] Support a versioned committed baseline for existing policy violations; it may not hide collection failures, identity ambiguities, stale formal outputs, or newly added and modified violations.
- [ ] Add unit and integration coverage across JavaScript/TypeScript, Vue templates and bindings, and the supported React demo source shapes, including a baseline regression suite.
- [ ] Update a demo to contrast permitted automatically collected static Chinese with a dynamic message migrated to the explicit manifest-backed call, then refresh its committed collection artifacts.
- [ ] Update documentation and lessons with the complete-static-copy rule, migration workflow, and baseline semantics.
