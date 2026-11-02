# 03: Preserve Catalog Lifecycle Across Source and Localized Occurrences

**What to build:** Catalogs remain coherent when a key has a mixture of source-text occurrences and localized-call occurrences, preserving canonical source, fingerprints, and translation review lifecycle.

**Blocked by:** #01: Introduce Metadata v3 and Opaque Automatic Keys; #02: Collect Localized-Call Occurrences and Validate References

**Status:** ready-for-agent

- [ ] A compatible source-text occurrence supplies the canonical source text.
- [ ] When all active occurrences are localized calls, the last canonical source text remains available.
- [ ] A localized call never replaces canonical source text with an empty value.
- [ ] A uniquely matched source-text change preserves the key and updates the source fingerprint.
- [ ] Existing target translations become `needs-review` after a source change.
- [ ] Incompatible message contracts still fail collection.
- [ ] Tests cover mixed occurrences, all-localized occurrences, source changes, fingerprints, and review-state transitions.
