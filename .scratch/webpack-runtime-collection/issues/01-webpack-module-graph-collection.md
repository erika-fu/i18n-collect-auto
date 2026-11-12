# 01: Establish Webpack module graph collection

**What to build:** Make `collect` run a real Webpack compilation and collect runtime-localizable messages only from modules reachable in the current live module graph.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Collection uses the active Webpack loader source flow and does not reread source from disk through a loader pitch hook.
- [ ] Unreachable resources are excluded from runtime collection.
- [ ] Collection state is scoped to the current compiler and is not implicitly shared across compilers.
- [ ] Collection failures do not publish partial results.
- [ ] Integration tests cover a successful Webpack collection compilation.
