# 09: Complete end-to-end regression for runtime collection

**What to build:** Add a repeatable regression suite that verifies the Webpack runtime collection design across package behavior, watch mode, Vue demos, static audits, and production builds.

**Blocked by:** 08: Migrate command ownership and demos to the new workflow.

**Status:** ready-for-agent

- [ ] Unreachable modules never enter the runtime catalog.
- [ ] Watch removal or reachability changes remove stale findings.
- [ ] Failed compilations do not publish partial snapshots or formal outputs.
- [ ] Collection and build replacement use the same findings.
- [ ] Standalone HTML and CSS never enter the runtime catalog.
- [ ] Key conflicts, placeholder conflicts, and unsafe replacement fail closed.
- [ ] `collect` and `build` do not modify application source.
- [ ] Translation providers, network requests, and credentials do not enter compilation.
- [ ] Schemas and output ordering are stable, and production verification is semantic.
- [ ] Multiple compilers do not share implicit collection state.
- [ ] Package tests, demo builds, and the complete regression command pass.
