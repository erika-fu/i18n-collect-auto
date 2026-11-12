# 01: Establish Webpack module graph collection

**What to build:** Make `collect` run a real Webpack compilation and collect runtime-localizable messages only from modules reachable in the current live module graph.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Collection uses the active Webpack loader source flow and does not reread source from disk through a loader pitch hook.
- [x] Unreachable resources are excluded from runtime collection.
- [x] Collection state is scoped to the current compiler and is not implicitly shared across compilers.
- [x] Collection failures do not publish partial results.
- [x] Integration tests cover a successful Webpack collection compilation.
