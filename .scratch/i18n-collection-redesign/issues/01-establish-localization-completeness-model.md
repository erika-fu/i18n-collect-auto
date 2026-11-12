# 01 — Establish the localization completeness model

**What to build:** Record the replacement domain model and architectural decisions that govern the redesign. Future work must have one authoritative definition of runtime localization coverage, Chinese source audit, and project localization completeness, including why HTML and CSS findings are audited rather than added to the runtime catalog.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The glossary defines a runtime-localizable message as a message that the supported build or source replacement path can turn into a runtime `t`/`$t` lookup.
- [x] The glossary distinguishes runtime localization coverage, Chinese source audit, and project localization completeness.
- [x] Project localization completeness requires complete runtime localization coverage and no unresolved Chinese source audit findings.
- [x] An accepted audit finding is defined as one migrated to a runtime-localizable surface, handled by a real adapter, or suppressed by an adjacent directive containing a non-empty reason.
- [x] An ADR replaces the per-occurrence automatic-key decision with deterministic keys derived from exact source text, while retaining explicit keys for contextual translation.
- [x] An ADR records that Vue replacement happens before template compilation, not against generated render functions, because Vue static optimizations must remain correct during locale changes.
- [x] An ADR records that standalone HTML and styles are audit surfaces until an adapter can make their messages runtime-localizable.
- [x] Existing ADRs that conflict with the new decisions are explicitly superseded rather than silently edited into contradictory histories.
- [x] The documented command ownership states that scan writes source analysis outputs, translate writes target translation outputs, build and check are read-only, and source replacement writes source only when explicitly requested.

