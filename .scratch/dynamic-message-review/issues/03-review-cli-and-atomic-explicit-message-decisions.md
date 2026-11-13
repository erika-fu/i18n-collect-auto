# 03: Add review CLI and atomic explicit-message decisions

**What to build:** `i18n-collect review` lets developers list and inspect unresolved dynamic message candidates, then record auditable translate, intentionally-ignore, or defer decisions interactively and non-interactively. A Translate decision atomically updates the dynamic decision manifest and the explicit message manifest, preserving the latter as the authority for explicit keys, canonical Chinese source text, and placeholder contracts.

**Blocked by:** 02: Add dynamic decision manifest and candidate lifecycle validation.

**Status:** implemented

- [x] The CLI supports filtering/listing unresolved candidates and recording each supported decision with required confirmation and non-empty reasons where applicable.
- [x] A successful Translate operation writes compatible, mutually consistent decision and explicit-message inputs atomically; failure leaves neither partially changed.
- [x] The CLI can make compatible candidates in bulk while persisting a separate decision for every occurrence.
- [x] `review --prune` explicitly removes eligible migrated terminal decisions and never silently discards active decisions.
- [x] Regression tests cover interactive-independent/scriptable invocation, atomicity, validation failures, bulk eligibility, and pruning.
