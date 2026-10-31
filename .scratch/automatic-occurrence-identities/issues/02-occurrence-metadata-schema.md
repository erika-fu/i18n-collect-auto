# 02: Record stable occurrence identity in metadata

**What to build:** Metadata records enough stable source structure to identify, locate, and later match each automatic occurrence: its stable ID, semantic host, child role, local context, source location, and origin. Existing metadata either upgrades safely or fails with a clear migration path.

**Blocked by:** 01: Assign independent automatic keys to occurrences.

**Status:** ready-for-agent

- [x] Every automatic occurrence has a stable metadata identity distinct from its source text and coordinates.
- [x] Metadata schema versioning and migration behavior preserve formal outputs on upgrade failure.
- [x] Tests cover schema compatibility, deterministic output, atomic output behavior, and recovery from failed metadata publication.
