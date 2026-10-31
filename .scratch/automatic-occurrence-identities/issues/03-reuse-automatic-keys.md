# 03: Reuse automatic keys through collection history

**What to build:** A subsequent collection reuses an automatic key whenever metadata uniquely establishes that the current occurrence is the earlier one, even after source text edits, inserted lines, ordinary moves, or safe file moves; otherwise it allocates a new key.

**Blocked by:** 02: Record stable occurrence identity in metadata.

**Status:** ready-for-agent

- [ ] Matching uses structural anchors and context as primary evidence, with source text only as auxiliary evidence.
- [ ] Text edits, coordinate shifts, source moves, and safe resource moves retain the appropriate automatic key.
- [ ] Tests prove safe reuse and prove unmatched occurrences receive new keys without reusing an unsafe historical identity.
