# 04: Enforce explicit-key message contracts

**What to build:** Developers can use an explicit key to override automatic identity or intentionally share a translation unit. Sharing is allowed only when all occurrences have the same normalized message pattern and placeholder contract; incompatible uses fail before publication.

**Blocked by:** 01: Assign independent automatic keys to occurrences.

**Status:** ready-for-agent

- [x] Explicit keys can override an automatic key and can intentionally join multiple compatible occurrences.
- [x] One key naming incompatible source messages or placeholder contracts fails with all relevant occurrences reported.
- [x] Tests cover compatible sharing, source conflicts, automatic/explicit conflicts, and extensible message-pattern normalization boundaries.
