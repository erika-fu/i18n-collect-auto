# 02 — Add glob scope and optional context filters

**What to build:** Extend collection configuration so project-relative `include` and `exclude` continue to accept existing file/directory boundaries while also accepting glob patterns. `exclude` has final veto authority. Add opt-in, category-based context filters for candidates that a project does not consider user-facing, such as logging, tests, or analytics; collection remains inclusive by default so the tool never silently drops text based on heuristic inference.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Existing valid file/directory include and exclude configurations retain their behavior.
- [ ] Project-relative glob rules work across supported resources; invalid, absolute, escaping, or ambiguous patterns fail with actionable configuration errors.
- [ ] Exclusion wins whenever rules overlap, regardless of whether rules are boundaries or globs.
- [ ] Context filters are disabled by default, individually selectable by configuration, and documented as policy choices rather than hard-coded exclusions.
- [ ] Configuration changes remain visible to watch mode and have unit plus real Webpack integration coverage.
