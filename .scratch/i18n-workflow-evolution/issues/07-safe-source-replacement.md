# 07 — Preview safe source replacement

**What to build:** Provide a `replace` CLI subcommand that defaults to dry-run and transforms only safe JavaScript/TypeScript and Vue collection locations into runtime localization calls backed by the keyed catalog. Include Vue 2, Vue 3, and framework-neutral JavaScript-function runtime adapters. Recognize previously localized calls so repeated runs are idempotent. Validate that the selected adapter's required runtime integration already exists, but never install dependencies or rewrite application bootstrap code. Report every unsupported or unsafe candidate with a reason; strict mode turns such skipped candidates into failure. This ticket does not write source files yet.

**Blocked by:** 04 — Establish the keyed translation catalog.

**Status:** ready-for-agent

- [ ] Dry-run produces an intelligible per-file replacement preview without modifying source or catalog files.
- [ ] Vue 2, Vue 3, and generic JavaScript adapters have explicit supported semantic positions and validate their runtime prerequisites.
- [ ] Safe JS/TS and Vue candidates are previewed using their localization keys; already localized calls are recognized and not nested or recollected as source text.
- [ ] Unsafe contexts are skipped with source locations and reasons; strict mode fails instead of silently proceeding.
- [ ] React JSX, standalone HTML, and CSS generated content are explicitly outside first-release replacement scope.
- [ ] Fixtures and CLI tests demonstrate each adapter, idempotency, runtime validation, skipped candidates, and strict mode.
