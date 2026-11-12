# 10: Remove obsolete collection files and compatibility paths

**What to build:** After the new workflow and regression suite are complete, remove files and dead compatibility paths that are no longer needed by the Webpack runtime collection design, leaving the repository consistent and free of misleading legacy entry points.

**Blocked by:** 09: Complete end-to-end regression for runtime collection.

**Status:** done

- [x] Identify obsolete scanners, pitch-based collection integrations, retired collection plugins, superseded command wiring, and stale demo helpers that are no longer referenced.
- [x] Remove only files and compatibility paths proven unused by the new workflow.
- [x] Update documentation, package scripts, and imports so no removed path is referenced.
- [x] Preserve intentionally supported legacy migration behavior and do not remove active translation, check, or replace functionality.
- [x] The full package test suite, demo builds, and end-to-end regression pass after cleanup.
- [x] The final repository has no dead collection entry point that contradicts the approved design.

## Deletion inventory (verified)

### Identification pass

| Category | Finding |
| --- | --- |
| Obsolete scanners | No separate scanner module remained; filesystem walkers stay only for `scan` / `check` / `replace` / static audit. |
| Pitch-based collection | Loader has no `pitch`; deleted `.scratch/probe/**` pitch debug helpers. |
| Retired collection plugins | No removed-plugin stub left; live `MyI18nPlugin` kept. |
| Superseded command wiring | Removed filesystem build freshness (`assertSourceCatalogFresh`) and unused dictionary/catalog.meta publishers (`writeOutputs`, `loadPublishedCatalog`). Migration stubs kept. |
| Stale demo helpers | Removed `inspect` / `test-watch` scripts and `output.js` eslint ignore. |

### Dead compatibility paths

- `assertSourceCatalogFresh` — superseded by Webpack compilation catalog verification (`verifyCommittedCatalogAgainstCompilation`).
- `writeOutputs` — superseded by `publishCollectionOutputs` / `commitFiles`.
- `loadPublishedCatalog` — unused build-path catalog.meta reader after compilation-driven replacement.
- Unused `LEGACY_IDENTITY_ARTIFACT` export (migration guidance remains in `docs/migration.md`).

### Removed files / helpers

- `.scratch/probe/**` — pitch-phase debug probe that contradicted normal-phase collection.
- Demo `inspect` / `test-watch` scripts and `output.js` eslint ignore — stale Vue CLI debug helpers outside `i18n-collect` collect/build.

### Kept (still referenced)

- Filesystem `scan`, migration CLI stubs (`verify` / `run` / `check-policy`), `legacy-contraction.js`, `migrate-keys`, translate / check / replace, and active Webpack collection loader/plugin.

### Verification

- `npm test` (package suite) passed.
- `npm run regression` (package tests + Vue2/Vue3/React demo builds + hybrid gate) passed.
