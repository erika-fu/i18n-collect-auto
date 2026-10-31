# 06: Track translation review and occurrence retirement

**What to build:** Existing translations remain available after a source message pattern changes but become marked for review. Occurrences missing from a collection round move through an auditable active, orphaned, and retired lifecycle rather than losing translation history immediately.

**Blocked by:** 03: Reuse automatic keys through collection history; 04: Enforce explicit-key message contracts.

**Status:** ready-for-agent

- [x] Source message changes preserve target translation text and mark the relevant locale translation as needing review.
- [x] Missing occurrences become orphaned and only retire after the agreed confirmation or prune policy; returning occurrences recover safely.
- [x] Tests cover multiple collection rounds, review-state consistency, pruning, return from orphaned status, and catalog/metadata consistency.
