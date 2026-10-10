# 03: Ensure consistency across incremental builds and failed rounds

**What to build:** Harden the Loader-only collection pipeline so that the Collection result always represents the current valid source in webpack watch mode and in the presence of filesystem cache, file deletion, removed imports, deleted Vue blocks, concurrent compilations, and build failures; no failed round may publish partial results or overwrite the last successful output.

Before starting, you MUST read the root `CONTEXT.md`, `docs/collection-architecture.md`, `docs/collection.md`, and the code and tests from Tickets 01–02. Do not restore Plugin source scanning as a solution.

**Blocked by:** 02: Switch existing collection to the Loader-only pipeline

**Status:** ready-for-agent

## Required lifecycle

- The Session maintains committed snapshots separately from candidate rounds scoped to a Compilation.
- When a Loader runs, it submits a complete snapshot to the candidate round for the corresponding main compilation and updates the module's `buildInfo` metadata.
- In a webpack 5 hook that runs after the module graph has stabilized, the Plugin rebuilds the live snapshot set from `compilation.modules`. Current compilation membership is authoritative; modules do not have to end up in a chunk, preventing tree-shaking from changing collection semantics.
- If a Compilation has any webpack/Loader/parse error, abandon the candidate; the committed state and both published outputs MUST remain unchanged.
- A valid compilation atomically replaces the committed live set, then aggregates and writes the pair of documents.
- Overlapping or rapidly consecutive compilations MUST NOT commit to each other's candidate rounds.

## Cache and unchanged modules

- Webpack incremental builds do not rerun every Loader; snapshots for unchanged modules MUST be restored from the current module metadata.
- When webpack filesystem cache restores data across compiler instances, the metadata MUST remain serializable and verifiable.
- “No physical Loader invocation occurred in this round” MUST NOT itself be treated as an error: if the current module graph contains valid cached metadata, the Loader is considered integrated.
- Metadata that is invalid, uses the wrong schema, or does not belong to the current root compiler/config MUST NOT silently enter the result; emit an appropriate diagnostic.

## Stale snapshot eviction

After a valid round is committed, the following MUST be removed:

- deleted files;
- resources that are no longer imported and have left the current module graph;
- deleted Vue blocks;
- stale identities left after a style index/lang change;
- old entries when the Loader reruns in the current round and submits an empty snapshot;
- resources that no longer satisfy include/exclude after a configuration change.

A snapshot MUST NOT be retained merely because its file still exists on disk, nor may all state be cleared on every round with a requirement that every Loader rerun.

## Failure and output behavior

- A script parse error, webpack compilation error, or output preparation error causes the round to fail.
- Failure errors SHOULD preserve webpack's original diagnostics; collection-specific errors MUST include at least the project-relative path, semantic block, and original location when applicable.
- A failed round MUST NOT modify the committed in-memory result or rewrite either published output.
- Preserve the existing paired/rollback output semantics and byte-equality short circuit.
- When the contents of both outputs are unchanged, do not create temporary files or trigger filesystem events.
- The two outputs SHOULD behave as a single published release; the system MUST NOT leave one new file and one old file for an extended period.

## Watch behavior

The current demo imports the runtime dictionary. A genuine dictionary change may trigger one subsequent compilation so that the new dictionary enters the watch bundle; once the next round sees identical bytes, it MUST stop writing and recompiling.

This Ticket does not address the possibility that a one-time production bundle may contain the previous dictionary version, but it MUST NOT allow watch mode to loop indefinitely.

## Config invalidation

- When the configuration file exists, the Loader registers it as a webpack dependency.
- After the configuration changes, the relevant Loader/metadata MUST be invalidated and the new configuration MUST be used in the next valid round.
- `configHash` reflects the complete normalized configuration.

## Non-goals

- Do not implement the HTML/CSS extractor.
- Do not handle HTMLWebpackPlugin child compilation caching; that special case is completed in Ticket 05, but this Ticket's session API MUST support child-to-main association and a subsequent retention policy.
- Do not address dictionary freshness in a one-time bundle.
- Do not restore directory scanning or disk-existence scanning.

## Acceptance criteria

- [ ] In watch mode, the cached snapshots of unchanged modules are retained even when their Loaders do not rerun.
- [ ] With webpack filesystem cache enabled, build output is identical across compiler instances to output produced with the cache disabled.
- [ ] When only cached metadata is present and no physical Loader invocation occurs in the current round, the system does not incorrectly report that the Loader is not integrated.
- [ ] Deleting a file, removing an import, deleting a Vue block, or changing a style identity accurately evicts the stale snapshot.
- [ ] When a Loader submits an empty snapshot, the previous copy for that identity is cleared.
- [ ] After a failed parse/build round, the in-memory committed result and both published outputs remain at the last successful version, with no partial results published.
- [ ] Candidate data from two overlapping/consecutive compilations does not leak between rounds.
- [ ] Multiple compilers remain isolated, and a session can be reclaimed with its root compiler.
- [ ] Identical output causes no disk writes; a genuine change triggers at most one subsequent watch compilation and then settles.
- [ ] A configuration-file change triggers correct invalidation, and filtering plus `configHash` are updated in the next valid round.
- [ ] Tests cover begin/submit/commit/abandon, cache restore, stale eviction, failed rounds, and watch settling without relying on the Plugin to scan source code.
- [ ] Package tests and the demo production build pass.
