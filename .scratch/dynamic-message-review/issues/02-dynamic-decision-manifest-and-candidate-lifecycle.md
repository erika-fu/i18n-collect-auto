# 02: Add dynamic decision manifest and candidate lifecycle validation

**What to build:** `collect` and `scan` consume the version-controlled dynamic message decision manifest and regenerate the disposition of every dynamic message candidate. The workflow distinguishes unreviewed, intentionally ignored, translation-approved-but-not-yet-migrated, and migrated candidates while ensuring a decision applies to exactly one still-matching candidate.

**Blocked by:** 01: Establish dynamic message candidate schema and whole-expression discovery.

**Status:** ready-for-agent

- [ ] Matching decision entries produce the correct generated candidate dispositions in both collection workflows, while each candidate occurrence keeps an independent review identity and decision.
- [ ] Unverifiable or ambiguous active translate/ignore decisions fail the collection round and preserve the previous formal outputs.
- [ ] A completed source migration may retain a verifiable migrated decision terminal state rather than being treated as an invalid stale decision.
- [ ] Regression tests cover successful matching, source changes, removed candidates, ambiguous matches, collection atomicity, and collect/scan parity.
