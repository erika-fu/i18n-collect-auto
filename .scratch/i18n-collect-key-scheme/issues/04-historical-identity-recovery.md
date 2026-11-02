# 04: Recover Historical Occurrence Identities Conservatively

**What to build:** Collection preserves historical automatic keys across moves, formatting changes, resource restructuring, and uniquely matched wording changes, while stopping safely when identity cannot be determined.

**Blocked by:** #01: Introduce Metadata v3 and Opaque Automatic Keys

**Status:** ready-for-agent

- [ ] A unique historical candidate preserves its previous key.
- [ ] Source location is not treated as an independent durable identity.
- [ ] Collection never silently selects a candidate by nearest line, highest score, or another heuristic tie-breaker.
- [ ] Multiple viable candidates produce a stable ambiguity report and fail the round.
- [ ] Proposed automatic keys enter formal metadata only after a successful round.
- [ ] The ambiguity report keeps a proposed key stable across retries.
- [ ] Identity confirmation can select a historical candidate or the proposed key.
- [ ] Failed rounds preserve all previous formal outputs.
- [ ] Tests cover moves, reordering, duplicate text, deletion and reappearance, ambiguity, and confirmation.
