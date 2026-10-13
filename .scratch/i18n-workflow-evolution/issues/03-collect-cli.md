# 03 — Provide the collection CLI workflow

**What to build:** Provide a standalone, automation-friendly `collect` CLI subcommand that runs the established collection workflow using project configuration with explicit command-line overrides. It must preserve the current hash dictionary and source-map contract, produce a stable human- and machine-usable collection report, and never translate, rewrite source, or make network requests. The implementation may invoke or orchestrate the existing Webpack integration rather than duplicating semantic extraction, but that boundary must be explicit and tested.

**Blocked by:** 01 — Support the local exclusion directive; 02 — Add glob scope and optional context filters.

**Status:** ready-for-agent

- [ ] `collect` can be invoked non-interactively from a project and observes configured and command-line collection scope rules.
- [ ] Existing collection outputs remain compatible and successful collection behavior is deterministic.
- [ ] The command supplies useful help, exit codes, and diagnostics for configuration, collection, and build failures.
- [ ] The command makes no network request and never changes application source files.
- [ ] CLI integration tests demonstrate collection, override behavior, output compatibility, and failure reporting.
