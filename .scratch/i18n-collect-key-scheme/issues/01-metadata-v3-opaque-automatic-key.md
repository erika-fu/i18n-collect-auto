# 01: Introduce Metadata v3 and Opaque Automatic Keys

**What to build:** The collection system assigns new automatic identities as `auto.<ULID>` and transactionally upgrades legacy catalog metadata without changing existing keys.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] New automatic keys are opaque and contain no path, source text, line, or column information.
- [ ] Candidate keys are persisted only after a successful collection round; failed rounds leave formal outputs unchanged.
- [ ] Version 2 metadata upgrades transactionally to version 3 during a successful collection.
- [ ] Catalog entries and occurrences record `source-text` or `localized-call` representation.
- [ ] Existing automatic keys remain unchanged during migration.
- [ ] Tests cover ULID allocation, metadata migration, deterministic serialization, and rollback on failure.
