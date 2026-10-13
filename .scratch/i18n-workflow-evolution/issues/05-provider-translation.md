# 05 — Translate catalogs through a project provider

**What to build:** Provide a `translate` CLI subcommand and a project-supplied Translation Provider interface that can fill missing target-locale catalog entries from configured source text. The command must protect existing translations by default, support explicit `--retranslate`, and retain an existing translation while marking it as needing review when its source text changes. Its default partial-failure behavior preserves successful drafts and reports failed items; a configurable strict policy may make the operation atomic. All automated tests use local fake providers only.

**Blocked by:** 04 — Establish the keyed translation catalog.

**Status:** ready-for-agent

- [ ] A documented provider contract allows a project module to receive source text and requested target locales and return translation drafts.
- [ ] Missing translations are created without overwriting existing human translations by default.
- [ ] `--retranslate` explicitly permits replacement according to documented selection rules.
- [ ] Source-text changes mark retained target translations as needing review instead of silently treating them as current.
- [ ] Default partial failure preserves successful work and produces an actionable failure report; strict failure behavior is configurable.
- [ ] Tests use deterministic fake providers and do not require credentials, a vendor SDK, or network access.
