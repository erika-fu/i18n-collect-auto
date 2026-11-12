# 09: Complete end-to-end regression for runtime collection

**What to build:** Add a repeatable regression suite that verifies the Webpack runtime collection design across package behavior, watch mode, Vue demos, static audits, and production builds.

**Blocked by:** 08: Migrate command ownership and demos to the new workflow.

**Status:** done

- [x] Unreachable modules never enter the runtime catalog.
- [x] Watch removal or reachability changes remove stale findings.
- [x] Failed compilations do not publish partial snapshots or formal outputs.
- [x] Collection and build replacement use the same findings.
- [x] Standalone HTML and CSS never enter the runtime catalog.
- [x] Key conflicts, placeholder conflicts, and unsafe replacement fail closed.
- [x] `collect` and `build` do not modify application source.
- [x] Translation providers, network requests, and credentials do not enter compilation.
- [x] Schemas and output ordering are stable, and production verification is semantic.
- [x] Multiple compilers do not share implicit collection state.
- [x] Package tests, demo builds, and the complete regression command pass.
