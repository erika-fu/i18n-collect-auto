# 01: Establish dynamic message candidate schema and whole-expression discovery

**What to build:** `collect` and `scan` report complex user-facing Chinese as whole-expression dynamic message candidates rather than fragment-level explicit-required findings. Every candidate is locatable and contains a stable review identity, expression, static-fragment evidence, semantic context, capability, disposition, and diagnostic explanation. Candidate identity survives source-coordinate and formatting-only changes but changes for a real resource, structure, or semantic-context change. The analysis-report schema advances by a major version and replaces the obsolete fragment-model fields with dynamic candidate data and coverage.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `collect` and `scan` produce equivalent dynamic-message candidate semantics for interpolation, concatenation, conditional construction, dynamic keys, plural/formatting logic, and structured copy.
- [ ] The generated analysis report no longer exposes `explicitRequiredFindings` or `coverage.explicitRequired`, and consumers migrate to the new schema without retaining incompatible compatibility fields.
- [ ] Regression tests demonstrate whole-expression locations, static-fragment evidence, deterministic identities, and identity behavior for harmless versus semantic source changes.
