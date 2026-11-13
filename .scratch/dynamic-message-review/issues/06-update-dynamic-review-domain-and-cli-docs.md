# 06: Document the implemented dynamic message review workflow

**What to build:** The project’s public workflow documentation, migration guidance, domain glossary, ADRs, and CLI help accurately explain the implemented dynamic message candidate schema, decision lifecycle, completeness policy, review commands, and proven-safe `--write` boundary. Readers can distinguish available behavior from rejected or unsupported transformations without relying on historical context.

**Blocked by:** 03: Add review CLI and atomic explicit-message decisions; 04: Implement proven-safe review write migrations; 05: Evaluate dynamic candidates in localization completeness.

**Status:** implemented

- [x] Documentation uses the glossary’s runtime-localizable message, dynamic message candidate, explicit message manifest, and dynamic message decision manifest terminology consistently.
- [x] All references to fragment-level explicit-required findings, old coverage fields, and competing `--apply` write semantics are removed or clearly identified as superseded migration history.
- [x] CLI help and examples match actual command behavior, confirmation requirements, decision states, and unsupported rewrite classes.
- [x] Documentation review verifies that no pending design is presented as already implemented and that the final workflow is discoverable from the primary README and migration guide.
