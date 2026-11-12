# 10 — Unify project localization completeness checks

**What to build:** Provide one read-only check that tells users whether the project is fully localized. It must combine source freshness, runtime localization coverage, Chinese source audit disposition, and target-locale coverage without rewriting any project file.

**Blocked by:** 03 — Audit standalone HTML end to end; 04 — Audit CSS and style preprocessors end to end; 07 — Simplify the translation lifecycle; 08 — Make build replacement read-only.

**Status:** done

- [x] Check performs current analysis in memory and compares it with committed scan outputs without writing files.
- [x] Runtime coverage reports automatically localizable, already localized, and explicit-required messages separately.
- [x] Source audit reports unresolved, needs-review, and reasoned-ignore HTML and style findings separately.
- [x] Locale coverage reports translated, missing, needs-review, and stale keys for every configured target locale.
- [x] Project localization completeness fails for stale source analysis, explicit-required messages, unresolved audit findings, missing translations, or needs-review translations.
- [x] Stale target keys are reported but do not fail completeness.
- [x] Reasoned ignored audit findings remain visible but count as disposed.
- [x] Human-readable output identifies concrete remediation, while JSON output has a stable machine-readable schema.
- [x] Check exits successfully only when the documented project localization completeness contract is met.
- [x] Tests assert that every check path is read-only, including failure and malformed-input paths.
