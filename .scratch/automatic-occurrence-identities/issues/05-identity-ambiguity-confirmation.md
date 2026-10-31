# 05: Report and resolve ambiguous occurrence identity

**What to build:** When collection history cannot uniquely identify an occurrence, collection never silently reuses an old translation identity. It creates a new automatic key, emits a machine-readable ambiguity report, and fails for CI until the ambiguity receives a durable confirmation.

**Blocked by:** 03: Reuse automatic keys through collection history; 04: Enforce explicit-key message contracts.

**Status:** ready-for-agent

- [ ] Multiple viable historical candidates generate an inspectable ambiguity report and a non-zero collection result.
- [ ] Source key directives provide a durable resolution, and a version-controlled confirmation manifest supports sources that cannot be edited.
- [ ] Tests cover repeated siblings, refactors with multiple candidates, resolved reruns, and preservation of prior formal outputs on failure.
