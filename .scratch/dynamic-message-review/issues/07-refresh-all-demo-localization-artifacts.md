# 07: Refresh all demo localization artifacts through the new workflow

**What to build:** The standard demo, React demo, and Vue 3 demo are migrated so their source and committed collection artifacts reflect the final dynamic message review workflow. Each demo demonstrates a real, clean collection lifecycle rather than manually edited generated output.

**Blocked by:** 03: Add review CLI and atomic explicit-message decisions; 04: Implement proven-safe review write migrations; 05: Evaluate dynamic candidates in localization completeness.

**Status:** implemented

- [x] Every committed demo catalog input and generated localization artifact is reconciled with the current collection schema and contains no retired fragment-model data.
- [x] Each demo resolves dynamic user-facing copy through an appropriate explicit migration, explicit decision, or documented supported exception, and `check` produces the intended clean result under its configured policy.
- [x] The refresh is performed through the product workflow—using collection, review, source replacement where applicable, translation synchronization, and checking—not by hand-editing generated collection outputs.
- [x] Demo runtime source-locale catalogs, target catalogs, metadata, reports, dictionaries, and translation state agree after regeneration.
