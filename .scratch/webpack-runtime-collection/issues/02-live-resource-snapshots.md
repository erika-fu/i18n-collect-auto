# 02: Support live resource snapshots and watch aggregation

**What to build:** Make Webpack watch rebuild collection from complete live resource snapshots so edits, deletions, and reachability changes are reflected after each successful compilation.

**Blocked by:** 01: Establish Webpack module graph collection.

**Status:** ready-for-agent

- [ ] Each processed resource submits a complete snapshot that replaces its previous snapshot.
- [ ] Edited resources replace old findings.
- [ ] Deleted or unreachable resources disappear from the aggregate result.
- [ ] Failed compilations preserve the previous complete snapshot and formal outputs.
- [ ] Vue blocks, resource queries, and other resource identities cannot overwrite one another.
- [ ] Watch tests cover additions, edits, removals, and failed rounds.
- [ ] Formal output publication is atomic.
