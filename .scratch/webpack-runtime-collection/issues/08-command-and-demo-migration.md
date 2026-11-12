# 08: Migrate command ownership and demos to the new workflow

**What to build:** Make the CLI and all demos follow the new collection, build, translate, check, and replace ownership contracts so the complete workflow is usable in development and production.

**Blocked by:** 05: Atomically publish and verify collection outputs; 06: Add independent standalone HTML and CSS static audit inputs; 07: Make build replacement consume the same compilation findings.

**Status:** done

- [x] `collect` runs Webpack collection and atomically publishes collection outputs.
- [x] `collect --watch` publishes after successful rounds and preserves outputs after failed rounds.
- [x] `build` verifies collection outputs by default and writes only in-memory modules and bundles.
- [x] An explicitly enabled development build-write mode is required before build can publish collection outputs.
- [x] `translate` remains independent of Webpack and does not issue network requests during compilation.
- [x] `check` is read-only and blocks unresolved or needs-review findings as specified.
- [x] `replace` previews by default and writes application source only when explicitly requested.
- [x] Vue 2 and Vue 3 demos exercise their supported replacement adapters.
- [x] The React demo preserves collection and check behavior and documents that JSX replacement is out of scope for the initial version.
- [x] CLI help, demo scripts, documentation, catalogs, reports, and bundle tests reflect the new contract.
