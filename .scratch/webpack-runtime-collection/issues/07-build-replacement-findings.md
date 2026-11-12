# 07: Make build replacement consume the same compilation findings

**What to build:** Let Webpack build replacement rewrite only in-memory modules and emitted bundles using findings from the same compilation, without a second filesystem analysis or application-source writes.

**Blocked by:** 04: Collect safe user-facing text from Vue render functions; 05: Atomically publish and verify collection outputs.

**Status:** done

- [x] Build replacement consumes findings from the current compilation.
- [x] No independent filesystem reanalysis is performed to derive keys or occurrences.
- [x] JavaScript, Vue 2, and Vue 3 adapters define explicit call shapes and safe rewrite positions.
- [x] Adapters verify that the required runtime `t` or `$t` integration is already available.
- [x] The initial implementation does not guess or inject runtime imports or helpers.
- [x] Collection may succeed when a finding cannot be safely replaced, but strict replacement mode fails closed.
- [x] Standalone HTML and CSS are excluded from replacement.
- [x] Emitted bundles contain the expected runtime lookups while application source remains unchanged.
