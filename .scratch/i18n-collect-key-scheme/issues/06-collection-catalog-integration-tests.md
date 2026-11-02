# 06: Add Collection and Catalog Integration Coverage

**What to build:** The real collection pipeline verifies the identity model end to end rather than relying only on isolated unit tests.

**Blocked by:** #02: Collect Localized-Call Occurrences and Validate References; #03: Preserve Catalog Lifecycle Across Source and Localized Occurrences; #04: Recover Historical Occurrence Identities Conservatively; #05: Enforce Explicit and Runtime Identity Conflict Rules

**Status:** ready-for-agent

- [ ] The complete collection-to-metadata-to-catalog flow is covered.
- [ ] A source already replaced with a localized call remains consistent after ordinary collection.
- [ ] Moves, formatting changes, wording changes, and ambiguity are covered through the real integration boundary.
- [ ] Failed rounds leave dictionary, source map, catalog, and metadata at their previous versions.
- [ ] Repeated collection and cache reuse do not cause key churn.
- [ ] Failures identify whether the problem is in identity recovery, catalog lifecycle, or transactional output.
