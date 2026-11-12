# 03 — Audit standalone HTML end to end

**What to build:** Make standalone HTML a first-class Chinese source audit surface without treating its text as runtime catalog messages. Users must be able to see actionable HTML findings and explicitly dispose of findings that intentionally remain untranslated.

**Blocked by:** 02 — Introduce unified project analysis.

**Status:** done

- [x] Standalone HTML analysis uses a structured HTML parser rather than regular-expression extraction.
- [x] Visible text nodes and configured user-facing attributes are reported with original source locations.
- [x] Comments, element names, non-user-facing attributes, scripts, styles, and formatting-only whitespace do not become audit findings.
- [x] HTML audit findings never receive localization keys and never enter source or target catalogs.
- [x] An adjacent `i18n-ignore` directive suppresses exactly the associated finding only when it includes a non-empty reason.
- [x] Malformed, reasonless, unused, or ambiguously associated ignore directives fail with actionable diagnostics.
- [x] Unresolved HTML findings make project localization completeness fail.
- [x] Resolved HTML findings remain visible in the machine-readable report as intentionally ignored, including their reason.
- [x] Equivalent behavior is covered through scan and check command tests.

