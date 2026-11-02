# 09: Run Tests, Builds, and Demo Verification

**What to build:** The implementation is verified against the existing package tests, new identity tests, both demo builds, and actual runtime lookup behavior.

**Blocked by:** #06: Add Collection and Catalog Integration Coverage; #07: Update the Demo for the Stable Key Lifecycle; #08: Verify the End-to-End Migration Workflow

**Status:** done

- [x] The complete package test suite passes.
- [x] All new collection, metadata, identity, catalog, migration, and workflow tests pass.
- [x] The Vue demo production build passes.
- [x] The React demo production build passes.
- [x] The demo runtime or an equivalent runtime verification resolves the expected localization keys and translations.
- [x] Hash dictionary, source map, catalog, and runtime lookup compatibility are verified.
- [x] Test and build results are recorded accurately; failures are explicitly documented rather than summarized as successful.

## Verification record (2026-11-02)

Environment: Windows 10, Node via workspace scripts, branch `main` at `bd7c59f` plus local verification artifacts below.

### Package tests

Command: `npm test` (workspace → `i18n-collect` → `node --test test/*.test.js`)

Result: **pass** — 307 tests, 0 fail, duration ≈ 17.7s.

Non-fatal noise only: Watchpack `EINVAL` on Windows system files during watch tests; Browserslist “caniuse-lite is outdated” notices. No test failures.

### Identity / catalog / migration / workflow subset

Command (from `packages/i18n-collect`):

```text
node --test test/collection-catalog-integration.test.js \
  test/catalog-lifecycle-source-localized.test.js \
  test/localized-call.test.js \
  test/occurrence-lifecycle.test.js \
  test/demo-runtime-migration.test.js \
  test/end-to-end-migration-workflow.test.js \
  test/migration-workflow.test.js
```

Result: **pass** — 39 tests, 0 fail.

These seven files are the new identity / catalog / migration / workflow coverage added for this initiative; the full package suite (307) also includes earlier unit and CLI coverage that these files build on.

Includes committed Vue demo runtime resolution (`demo-runtime-migration.test.js`: keyed catalog first, MD5 hash-dictionary fallback, VueI18n `$t` lookups for explicit and automatic keys).

### Vue demo production build

Command: `npm run build`

Result: **pass** — `vue-cli-service build` compiled successfully (≈ 3.7s). Committed `apps/demo/lang/**` was **unchanged** by this build.

### React demo production build

Command: `npm run build-react-demo`

Result: **pass** — webpack production compile succeeded.

Collection side effect under the current plugin contract (React demo previously tracked only the hash dictionary + source map):

- Updated `apps/react-demo/lang/zh_hash.map.json` `configHash` (`c0c00efc…` → `0b45581a…`).
- Wrote `apps/react-demo/lang/catalog/{zh.json,catalog.meta.json}` (metadata v3, six opaque `auto.<ULID>` keys).

These refreshed collection outputs are part of the verification working tree so a later `build-react-demo` / `update-react-demo-collection` does not leave an unexplained dirty tree. Second production build reused the same catalog keys and values (no key churn).

`apps/react-demo` is a **collection** demo: source still renders Chinese literals directly and has no keyed localization runtime comparable to Vue I18n. Runtime key/translation resolution for this issue is therefore verified on the Vue demo (tests + `resolveDemoMessage`); React verification is build success plus hash / map / catalog structural compatibility.

### Runtime / compatibility checks

Vue runtime (in addition to `demo-runtime-migration` tests), via one-shot Node asserts against committed `apps/demo/lang/**` and `apps/demo/src/lang/resolve.js`:

- `catalog.meta.json` version 3; 40 hash / map entries; 49 zh catalog keys.
- Two independent automatic keys for equal source text `请稍候`.
- `resolveDemoMessage('demo.visit.banner', en, hash)` → `Welcome aboard`.
- MD5 `47781b8a72bcbb7ecb1f955399a7e718` falls back to hash dictionary → `欢迎`.
- Empty catalog string does not fall through to the hash dictionary.

React collection compatibility (same Node asserts against refreshed `apps/react-demo/lang/**`):

- `catalog.meta.json` version 3; six automatic keys; each catalog value equals its metadata `source`.
- Hash dictionary MD5 keys match values; source-map entries match the hash dictionary 1:1.
- Hash dictionary text set equals catalog text set (hash remains text-deduplicated; catalog is per-occurrence).

### Failures

None. All commanded suites and builds exited 0; compatibility asserts succeeded.
