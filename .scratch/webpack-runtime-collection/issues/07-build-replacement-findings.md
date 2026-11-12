# 07: Make build replacement consume the same compilation findings

**What to build:** Let Webpack build replacement rewrite only in-memory modules and emitted bundles using findings from the same compilation, without a second filesystem analysis or application-source writes.

**Blocked by:** 04: Collect safe user-facing text from Vue render functions; 05: Atomically publish and verify collection outputs.

**Status:** ready-for-agent

- [ ] Build replacement consumes findings from the current compilation.
- [ ] No independent filesystem reanalysis is performed to derive keys or occurrences.
- [ ] JavaScript, Vue 2, and Vue 3 adapters define explicit call shapes and safe rewrite positions.
- [ ] Adapters verify that the required runtime `t` or `$t` integration is already available.
- [ ] The initial implementation does not guess or inject runtime imports or helpers.
- [ ] Collection may succeed when a finding cannot be safely replaced, but strict replacement mode fails closed.
- [ ] Standalone HTML and CSS are excluded from replacement.
- [ ] Emitted bundles contain the expected runtime lookups while application source remains unchanged.
