# 10: Remove obsolete collection files and compatibility paths

**What to build:** After the new workflow and regression suite are complete, remove files and dead compatibility paths that are no longer needed by the Webpack runtime collection design, leaving the repository consistent and free of misleading legacy entry points.

**Blocked by:** 09: Complete end-to-end regression for runtime collection.

**Status:** ready-for-agent

- [ ] Identify obsolete scanners, pitch-based collection integrations, retired collection plugins, superseded command wiring, and stale demo helpers that are no longer referenced.
- [ ] Remove only files and compatibility paths proven unused by the new workflow.
- [ ] Update documentation, package scripts, and imports so no removed path is referenced.
- [ ] Preserve intentionally supported legacy migration behavior and do not remove active translation, check, or replace functionality.
- [ ] The full package test suite, demo builds, and end-to-end regression pass after cleanup.
- [ ] The final repository has no dead collection entry point that contradicts the approved design.
