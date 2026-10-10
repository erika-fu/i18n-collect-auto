# 07: Harden the Real-Build Contract and Complete User Documentation

**What to build:** Validate Loader-owned collection for Script, Vue/standalone HTML, and CSS together in a real webpack 5/Vue CLI project; complete cache, watch, cross-platform coordinate, deterministic output, and user documentation coverage so the entire capability can be delivered reliably and future implementers can understand the supported scope and known limitations.

Before starting, you MUST read the root `CONTEXT.md`, `docs/collection-architecture.md`, `docs/collection.md`, and all implementations, tests, and acceptance results for Tickets 01–06. This Ticket covers integration and hardening; it MUST NOT reintroduce Plugin source scanning or expand the confirmed scope.

**Blocked by:**
- 04: Collect HTML Copy from Vue Templates
- 05: Collect Copy from Raw HTMLWebpackPlugin Templates
- 06: Collect Standard CSS Generated Content

**Status:** ready-for-agent

## End-to-end contract

The real demo build MUST form a single data path:

```text
Script/HTML/CSS resource enters myloader
→ corresponding pure extractor creates a complete snapshot
→ webpack module metadata/session
→ MyI18nPlugin aggregates the current valid round
→ stable runtime dictionary and source map
```

The Plugin does not read business source code; files that do not enter the Loader chain are not collected; a failed build does not publish partial results.

## Integration hardening

- Inspect and test the actual execution order of the collector and Babel, vue-loader, template compiler, style pipeline, and HTMLWebpackPlugin template loader in the final webpack config. Do not rely solely on rule names, `.before()`/`.after()`, or comments.
- Use a real webpack 5 module graph to cover Script, Vue templates, multiple Vue style blocks, standalone CSS, and the original HTML template.
- Verify identical results with webpack filesystem cache enabled and disabled, and ensure restoring module metadata across compiler instances neither loses data nor crosses sessions.
- Verify HTMLWebpackPlugin's initial child compilation, cached child rebuild, template replacement, and deletion.
- Verify stale eviction for removed imports, deleted files, deleted blocks, empty replacement snapshots, and config filter changes.
- Verify that a failed round preserves committed in-memory state and both official outputs.
- Verify that identical bytes cause no output writes; a real dictionary change triggers at most one subsequent compilation in watch mode and then becomes quiet.
- Ensure deterministic sorting of output keys, entries, and locations across caches, platform separators, and repeated builds. If existing location sorting uses JSON strings and therefore sorts numeric positions lexicographically, replace it with explicit field/numeric sorting without changing the schema, and add tests.

## Coordinate and decoding matrix

Integration tests cover at least:

- LF and CRLF;
- `/` and Windows-style path normalization;
- An astral character before a fragment, with columns still counted in UTF-16 code units;
- The decoded value and original range of an HTML entity;
- The decoded value and original range of a CSS escape;
- New HTML/CSS ranges excluding syntax delimiters;
- Backward compatibility of historical JavaScript ranges;
- Location aggregation and exact deduplication for the same value across multiple files/kinds/blocks.

Coordinates are formally defined as 1-based lines, 0-based UTF-16 columns, and half-open/end-exclusive ranges.

## Demo acceptance

The demo SHOULD clearly demonstrate and verify:

- Script strings and template literals;
- Vue interpolation;
- Vue HTML text;
- allowlisted static/dynamic Vue attributes;
- original standalone HTML text/attributes;
- Vue CSS generated content;
- standalone CSS generated content;
- ignored non-allowlisted/non-content examples;
- an unsupported style preprocessor warning (an isolated fixture may be used; the default runtime experience need not be affected).

Checked-in demo collection outputs MUST be updated through an explicit, reproducible fixture/build workflow; ordinary unit tests MUST NOT accidentally rewrite repository files.

## Documentation

Update user and maintainer documentation to explain at least:

- The responsibility boundary between Loader collection and Plugin session/aggregation/output;
- The webpack 5 limitation and integration method;
- Supported scope for JS, Vue templates, standalone HTML, and standard CSS;
- `attributeAllowlist`, `styleExtensions`, `include`, `exclude`, and output fields;
- Why the HTMLWebpackPlugin template chain is forced;
- The maintenance semantics of Resource identity and complete replacement snapshots;
- Unsupported SCSS/Sass/Less/Stylus is warning/skip only;
- Parse errors fail the round and preserve the old output;
- A real change in watch mode may require one additional compilation;
- A known limitation of one-shot production builds: the on-disk dictionary is the latest result from the current round, but the bundle from that same round may still embed the previous dictionary;
- The Plugin does not scan the project, and resources that do not pass through the Loader are not collected;
- Source rewriting, final-bundle scanning, webpack 4, Vite/Rollup, dynamic expression execution, and `no-i18n-auto` are not supported.

Update `CONTEXT.md`, ensuring it contains domain vocabulary only and no implementation steps; explicitly define Source coordinate's 0-based UTF-16 column. Keep architecture design and phase information in `docs/collection-architecture.md`, and troubleshooting and watch behavior information in `docs/collection.md`.

## Schema compatibility

- The runtime dictionary remains `{ md5: value }`.
- The source map continues to use `version: 1` and the existing Semantic kinds.
- Retain `parserVersion: 'babel-7'` for now and document it as a historical JavaScript parser marker; do not opportunistically upgrade the schema in this Ticket.
- Preserve output byte formatting, stable ordering, pair write/rollback, and the equality short circuit.

## Non-goals

- Do not close the loop for a one-shot bundle consuming the new dictionary from the same round.
- Do not add a Sass/Less/Stylus parser.
- Do not implement source rewriting, a translation API, Vite/Rollup, webpack 4, or `no-i18n-auto`.
- Do not establish a parser plugin framework.
- Do not scan the final bundle or business files that do not enter the Loader chain.

## Acceptance criteria

- [ ] All package tests pass, with the test structure clearly distinguishing resource, extractor, session, Loader, webpack, HWP, and watch contracts.
- [ ] The demo Vue CLI production build passes, with correct behavior for page HTML, JavaScript, CSS, template placeholders, and source maps.
- [ ] The final Loader execution order is proven by integration tests.
- [ ] Script, Vue HTML, standalone HTML, Vue CSS, and standalone CSS all produce the expected entries/kinds/locations in a real build.
- [ ] Output is identical with webpack filesystem cache enabled and disabled, and multiple compilers/sessions do not contaminate one another.
- [ ] HWP child cache, resource deletion/unreferencing, block deletion, filter changes, and failed rounds all have end-to-end coverage.
- [ ] A real watch change adds at most one compilation and eventually becomes quiet; identical output is not written to disk.
- [ ] CRLF, Windows paths, astral/UTF-16 behavior, HTML entities, CSS escapes, duplicate locations, and numeric position sorting all have regression tests.
- [ ] Demo fixtures and checked-in outputs are updated through an explicit workflow, and ordinary tests do not dirty the working tree.
- [ ] README, collection docs, architecture docs, and the domain glossary are mutually consistent and fully explain configuration, supported scope, error behavior, non-goals, and the one-shot bundle limitation.
- [ ] The runtime dictionary and source-map v1 schema remain compatible.
