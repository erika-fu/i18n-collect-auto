# 02: Switch Existing Collection to a Loader-Only Pipeline

**What to build:** Make `myloader` the sole creator of Resource snapshots for Script text and existing Vue interpolation text, and make `myplugin` responsible only for managing the webpack compiler session, aggregation, and output. When complete, application source code will be collected only if it actually enters the Loader chain. The Plugin will no longer traverse directories, read source code, split Vue files with regular expressions, or call the Loader's internal extractor; the existing runtime dictionary and source-map v1 output must remain usable.

Before starting, you MUST read the root-level `CONTEXT.md`, `docs/collection-architecture.md`, `docs/collection.md`, and the implementation and tests from Ticket 01. The body of this Ticket lists all behavior required for independent execution; reviewing prior conversation is not required.

**Blocked by:** 01: Extract the Script Collection Core and Establish Resource Identity

**Status:** ready-for-agent

## Required end-to-end flow

```text
Resource enters myloader
→ Loader generates a complete snapshot for that Resource identity
→ snapshot is stored as serializable webpack module metadata
→ Plugin aggregates live snapshots from the current compilation modules
→ successful compilation outputs a compatible dictionary and source map
```

## Responsibilities

- The Loader is the sole creator of snapshots. The Plugin MUST NOT read or parse any application source code.
- Delete the Plugin code that recursively scans `src`, reads `.js/.vue` files, extracts `<script>/<template>` with regular expressions, parses mustache expressions, or calls internal Loader functions.
- The Plugin is responsible only for root-compiler-scoped sessions, the compilation lifecycle, snapshot aggregation, deduplication, and output.
- A fallback path in which the Plugin scans when the Loader does not provide coverage MUST NOT be retained.

## Session and metadata

- Use the webpack root compiler as the isolation boundary. Storing state in a `WeakMap<rootCompiler, CollectionSession>` is recommended; do not continue to use a process-global Store keyed by project root.
- HTMLWebpackPlugin child compilers and other child compilers MUST be normalized to the root compiler. This Ticket does not yet integrate standalone HTML, but the session design MUST NOT obstruct subsequent child-compiler support.
- The Loader writes a plain serializable snapshot to namespaced `buildInfo` metadata on the current module. At minimum, the snapshot includes a stable Resource identity, a project-relative path, module owner information, and entries.
- On every run, the Loader commits a complete replacement snapshot, including snapshots with zero entries. It MUST NOT incrementally append data by resource.
- The Plugin reads this metadata from the current compilation's module graph. The Loader creates the data; the Plugin only aggregates it.

## Existing Vue interpolation compatibility

- Babel strings and static template literal segments within existing Vue `{{ ... }}` expressions MUST move to the Loader side and continue to be labeled `template-expression`.
- This transitional implementation may use a minimal compatibility extraction path; production HTML text/attribute parsing will be completed in Ticket 04.
- Do not execute expressions or concatenate dynamic values from interpolation expressions into the text.
- Vue script/template/style MUST use distinct Resource identities; they can no longer overwrite one another through a single `.vue` path.
- If precisely restoring coordinates from the original `.vue` file requires it, the Loader may read the `resourcePath` currently being processed to locate the corresponding block; it MUST NOT scan directories or read other application resources. The Plugin still MUST NOT read source code.

## No-loader diagnostic

- Record evidence of Loader invocation separately; do not use the number of entries to determine whether the Loader is integrated.
- A Loader run that produces zero results is a valid successful state.
- If the current compilation has neither a real invocation nor evidence in current module metadata, fail the build and instruct the user to check ordinary rules, Vue block rules, and the future HTML template chain.
- Do not misclassify resources that ran through the Loader but were excluded by `include`/`exclude` as not integrated.

## Output and compatibility

- Preserve MD5 keys, the runtime dictionary object structure, source-map `version: 1`, existing Semantic kinds, and stable sorting.
- The Plugin continues to write `outputPath` and `sourceMapFilename` through the existing atomic output logic; it MUST NOT write when the bytes are identical.
- Retain `parserVersion: 'babel-7'` in this Ticket to avoid an unnecessary schema change.
- The existing public `myloader` / `myplugin` import paths remain unchanged.
- Fix the Loader integration and actual execution order for JS and Vue blocks in the demo so that the collector sees the original semantic resources that should be collected and transparently passes subsequent data through.

## Round scope in this ticket

This Ticket establishes the basic shape of candidate/committed rounds and the normal successful build path. Complete filesystem cache restoration, stale eviction, overlapping compilations, preserving old output after a failed round, and watch hardening will be completed in Ticket 03. Do not expand the scope by implementing Ticket 03 early, but this Ticket's interfaces MUST allow these behaviors to be implemented later.

## Non-goals

- Do not implement HTML text, HTML attributes, standalone HTML, or CSS `content`.
- Do not configure the HTMLWebpackPlugin template chain.
- Do not implement style preprocessors.
- Do not solve the issue of a one-time bundle consuming the new dictionary from the same round.
- Do not implement a general-purpose parser registry, source rewriting, or `no-i18n-auto`.

## Acceptance criteria

- [ ] In a normal webpack 5 compilation, the Loader snapshot is aggregated by the Plugin through module metadata, and the two compatible JSON files are written.
- [ ] The Plugin contains no application-directory traversal, application-source reading, source parsing, or calls to the Loader extractor.
- [ ] Files in `src` that are not imported and do not enter the Loader chain do not appear in the Collection result.
- [ ] The values, kinds, MD5 hashes, and sorting of existing script strings, template literal segments, and Vue interpolation fragments remain compatible.
- [ ] Vue script/template/style identities are independent, and snapshots from two blocks do not overwrite one another.
- [ ] The build succeeds when the Loader commits an empty snapshot, and that snapshot can replace old content for the same identity.
- [ ] A build with no Loader invocation or module metadata at all fails with a clear configuration error.
- [ ] Each webpack root compiler uses an isolated session; parallel compilers or test instances do not share results.
- [ ] The Loader and Plugin collaborate only through a neutral session/module-metadata layer; neither imports the other's application implementation.
- [ ] Public import paths, the runtime dictionary, and the outer source-map v1 structure remain unchanged.
- [ ] A real webpack integration test proves that the normal Loader-only path works; pure unit tests cannot replace this acceptance requirement.
- [ ] Package tests and one production build of the demo pass.
