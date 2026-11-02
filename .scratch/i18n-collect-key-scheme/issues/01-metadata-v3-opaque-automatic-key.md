# 01: Introduce Metadata v3 and Opaque Automatic Keys

**What to build:** The collection system assigns new automatic identities as `auto.<ULID>` and transactionally upgrades legacy catalog metadata without changing existing keys.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] New automatic keys are opaque and contain no path, source text, line, or column information.
- [x] Candidate keys are persisted only after a successful collection round; failed rounds leave formal outputs unchanged.
- [x] Version 2 metadata upgrades transactionally to version 3 during a successful collection.
- [x] Catalog entries and occurrences record `source-text` or `localized-call` representation.
- [x] Existing automatic keys remain unchanged during migration.
- [x] Tests cover ULID allocation, metadata migration, deterministic serialization, and rollback on failure.
