# 13 — Remove unused files and dependencies

**What to build:** Finish the redesign by removing files, fixtures, generated artifacts, package dependencies, and documentation that are no longer reachable from the supported product. This is a verified cleanup pass after migration, not an opportunity to change behavior.

**Blocked by:** 12 — Consolidate the CLI and migrate examples.

**Status:** done

- [x] Build a deletion inventory from module references, package entry points, command registration, tests, demo configurations, and documented workflows.
- [x] Every candidate is confirmed unused by production code, supported commands, tests, fixtures, demos, and release packaging before deletion.
- [x] Remove obsolete parser adapters, identity lifecycle helpers, replacement metadata helpers, superseded CLI modules, and migration-only compatibility code that no supported path references.
- [x] Remove fixtures and generated catalog artifacts that exist only for deleted behavior while preserving fixtures that prove current migration compatibility.
- [x] Remove package dependencies and development dependencies no longer imported by supported code or tests.
- [x] Remove or update stale lessons, references, and documentation that teach deleted architecture.
- [x] Package exports and executable entry points expose no deleted modules.
- [x] A repository-wide reference scan finds no dangling imports, command names, state filenames, or obsolete domain terms except intentional historical ADR context.
- [x] Package tests, all demo builds, translation workflows, source replacement, scan freshness, and completeness checks pass after cleanup.
- [x] The final change contains no unrelated formatting or refactoring.

## Deletion inventory (verified)

### Deleted files (zero production/test imports, or teach deleted architecture)

- `myloader/style-parser-{less,sass,scss,stylus,preprocessor}.js` — Issue 11 contracted preprocessor Style IR; only CSS parser remains.
- `test/cli-run.test.js` — duplicate of `cli-product-surface` + `legacy-contraction` migration coverage.
- `docs/collection.md`, `docs/collection-architecture.md`, `docs/vue-loader-loader-lifecycle-notes.md` — taught webpack collect / Plugin / occurrence identity.
- `README.zh-CN.md`, `LEARNING-NOTES.md`, `lessons/**`, `reference/**`, `assets/course.css` — same obsolete product surface.

### Dead code removed (migration stubs / live APIs kept)

- `cli/verify.js` — unreachable post-return verify implementation.
- `cli/collect.js` — unreachable webpack collect path; retained shared helpers used by `build`.
- `mycommon/catalog.js` — unreachable `buildCatalog` body, ULID allocation, identity readers, v1/v2 migrators; retained fingerprint / message contract / explicit messages / upgrade gate.
- `mycommon/build-replacement-contract.js` — unused occurrence/ambiguity helpers.
- `mycommon/output.js` — `writeOutputs` (only used by obsolete collect publish tests); tests retargeted to `commitFiles`.

### Kept (still referenced)

- Migration CLI stubs: `collect`, `verify`, `run`, `check-policy` + `legacy-contraction.js`.
- `migrate-keys`, replacement fixtures, demo `catalog.meta.json` / `zh_hash.*` formal outputs.
- Package deps (`@babel/*`, `parse5`, `postcss`, `source-map`) — still imported on supported paths; no dependency removals.

### Docs updated

- `RESOURCES.md`, `docs/agents/domain.md` — point at README / migration / CONTEXT / ADR-0008.
