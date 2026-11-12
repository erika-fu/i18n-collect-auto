# 06: Add independent standalone HTML and CSS static audit inputs

**What to build:** Analyze explicitly configured standalone HTML and CSS inputs as read-only audit surfaces while keeping them strictly separate from Webpack runtime collection and build replacement.

**Blocked by:** 05: Atomically publish and verify collection outputs.

**Status:** done

- [x] `staticAudit.include` manages an independent complete input snapshot.
- [x] Standalone HTML text and allowlisted attributes appear in the analysis report.
- [x] CSS generated content and conservative preprocessor candidates use the established semantic kinds and dispositions.
- [x] Audit findings never enter the source catalog or build replacement plan.
- [x] A reasoned `i18n-ignore` preserves the finding, reason, and `intentionally-ignored` disposition.
- [x] Unresolved and needs-review findings block completeness checks but do not block ordinary collection publication.
- [x] Missing, unreadable, or unparseable audit inputs fail closed.
- [x] Module-graph style audits and standalone audits use the same finding model.
