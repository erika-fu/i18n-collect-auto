# 05: Evaluate dynamic candidates in localization completeness

**What to build:** `check` evaluates dynamic message candidate dispositions as part of project localization completeness. It explains whether a project is blocked by an unreviewed candidate, a translation-approved candidate awaiting source migration, or a configured deferred candidate, without conflating those states with audit findings or target-translation review states.

**Blocked by:** 02: Add dynamic decision manifest and candidate lifecycle validation.

**Status:** ready-for-agent

- [x] Unreviewed candidates and translation-approved-pending-migration candidates block completeness by default with actionable diagnostics.
- [x] Projects can explicitly configure deferred candidates as warnings or errors; the default policy is error and does not silently waive never-reviewed candidates.
- [x] Existing audit `needs-review` and target translation `needs-review` behavior remains distinct and correct.
- [x] Regression tests cover policy defaults, warning and error configuration, disposition-specific diagnostics, and compatibility with existing completeness checks.
