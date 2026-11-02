# 04: Recover Historical Occurrence Identities Conservatively

**What to build:** Collection preserves historical automatic keys across moves, formatting changes, resource restructuring, and uniquely matched wording changes, while stopping safely when identity cannot be determined.

**Blocked by:** #01: Introduce Metadata v3 and Opaque Automatic Keys

**Status:** done

- [x] A unique historical candidate preserves its previous key.
- [x] Source location is not treated as an independent durable identity.
- [x] Collection never silently selects a candidate by nearest line, highest score, or another heuristic tie-breaker.
- [x] Multiple viable candidates produce a stable ambiguity report and fail the round.
- [x] Proposed automatic keys enter formal metadata only after a successful round.
- [x] The ambiguity report keeps a proposed key stable across retries.
- [x] Identity confirmation can select a historical candidate or the proposed key.
- [x] Failed rounds preserve all previous formal outputs.
- [x] Tests cover moves, reordering, duplicate text, deletion and reappearance, ambiguity, and confirmation.
