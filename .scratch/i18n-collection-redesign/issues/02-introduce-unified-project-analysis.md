# 02 — Introduce unified project analysis

**What to build:** Add a unified project analysis result alongside the existing collection model. A scan must classify Chinese found in JavaScript, TypeScript, Vue templates, and existing localization calls, write the source catalog, and report coverage without yet removing compatibility with the old collection outputs.

**Blocked by:** 01 — Establish the localization completeness model.

**Status:** done

- [x] One analysis interface returns runtime messages, audit findings, explicit-required findings, localized-call findings, and coverage totals.
- [x] Every finding includes source text, project-relative source location, source surface, semantic role, and capability classification.
- [x] Complete static JavaScript and TypeScript messages are classified as automatically runtime-localizable.
- [x] Static Vue template text and supported user-facing attributes are classified as automatically runtime-localizable.
- [x] Existing static `t`, `$t`, and `this.$t` calls are classified as already localized and retain their explicit localization key.
- [x] The scan command writes a deterministic source catalog and a machine-readable analysis report.
- [x] Scan output distinguishes source discovery totals from runtime-localization totals.
- [x] Existing collection integrations remain operational during this expand phase.
- [x] Tests exercise the analysis interface and CLI output through observable behavior rather than extractor internals.
- [x] Repeated scans over unchanged source produce byte-stable outputs.

