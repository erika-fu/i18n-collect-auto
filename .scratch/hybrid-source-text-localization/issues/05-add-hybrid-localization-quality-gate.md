# 05: Add the hybrid-localization quality gate

**What to build:** Developers and continuous integration have one reproducible verification entry point that checks formal collection outputs are current, checks that no new hybrid-localization policy violation is introduced, and runs the relevant package tests and demo builds with clear failure categories.

**Blocked by:** 02: Enforce complete static copy with an incremental baseline; 03: Enforce explicit localization for structured and shared messages; 04: Add runtime-multilingual feature boundaries.

**Status:** ready-for-agent

- [ ] Add a documented verification command or commands that run formal collection and fail when generated catalog or metadata output differs from committed artifacts.
- [ ] Include hybrid policy validation and baseline comparison, with distinct, actionable reporting for stale formal output versus an authoring-policy violation.
- [ ] Ensure collection failures, key conflicts, identity ambiguities, and invalid metadata remain hard failures and cannot be suppressed by the policy baseline.
- [ ] Cover the quality gate with automated regressions for clean worktrees, stale collection artifacts, a newly introduced violation, and a grandfathered baseline entry.
- [ ] Run and document the package test suite plus both demo builds as part of the verification workflow; update the demos' committed outputs when needed.
- [ ] Update contributor-facing documentation and lessons with local, review, and CI usage, including what an author should do for each failure category.
