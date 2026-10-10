# 05: Collect Copy from Raw HTMLWebpackPlugin Templates

**What to build:** Explicitly pass the Vue demo's raw HTMLWebpackPlugin template through the shared `myloader` to collect text and allowlisted attribute copy from standalone HTML, while leaving EJS-style placeholders, asset injection, final page content, and the Plugin-only-output responsibility unchanged; correctly handle HTMLWebpackPlugin child compiler cache and snapshot lifecycles.

Before starting, you MUST read the root `CONTEXT.md`, `docs/collection-architecture.md`, `docs/collection.md`, and the code and tests for Tickets 01–04. This Ticket does not depend on prior chat context.

**Blocked by:** 04: Collect HTML Copy from Vue Templates

**Status:** ready-for-agent

## Static HTML semantics

Reuse Ticket 04's rules for the HTML extractor, entities, whitespace, allowlist, and source coordinates, but use the following for standalone raw HTML:

- text node kind: `static-html-text`;
- static allowlisted attribute kind: `static-html-attribute`.

Only HTML that explicitly enters the Loader chain is collected. Do not restore `htmlEntries`, and do not have the Plugin proactively read templates.

EJS-style fragments themselves are neither executed nor rewritten; even if they contain Han characters in the future, do not pretend to know the user-visible result after template execution. The current scope collects only HTML text/attribute fragments that parse5 can determine statically.

## Required HTMLWebpackPlugin chain

Vue CLI's raw template contains constructs such as:

```html
<%= BASE_URL %>
<%= htmlWebpackPlugin.options.title %>
```

The configuration MUST explicitly preserve and force HTMLWebpackPlugin's template Loader. The semantic execution order is:

```text
Raw HTML
→ myloader collects and returns it byte-for-byte unchanged
→ html-webpack-plugin template loader (force=true)
→ HTMLWebpackPlugin executes the template and injects assets
```

Webpack normal loaders run from right to left. It is insufficient to add only a broad `.html` rule, or to set only `myloader!template.html`; either approach may cause the HTMLWebpackPlugin fallback loader to be skipped or not added.

In the Vue CLI configuration, replace only the existing HTML plugin's `template` request, preserving all other title, template parameters, script loading, and asset injection options. If the demo uses multi-page mode, the design SHOULD support applying the same convention to each HTML plugin instance, but there is no need to build a framework for pages that do not currently exist.

## Child compiler association

- HTMLWebpackPlugin compiles templates in a child compiler. The Loader MUST normalize the child compiler to the corresponding root compiler/main compilation session and MUST NOT create an orphaned session.
- Snapshot metadata remains plain serializable data.
- When the child compilation actually runs, the new snapshot replaces the old snapshot with the same identity.

## Cached child retention and eviction

HTMLWebpackPlugin may reuse a cached child compilation, so the template Loader might not rerun during a main compilation. A valid template result MUST NOT be deleted merely because "no HTML snapshot was submitted in this round."

A previously committed child snapshot is retained only when all of the following conditions hold:

- The template remains a live file dependency of the main compilation;
- The current HTMLWebpackPlugin is still configured with that template request;
- The file has not been deleted;
- No new child snapshot replaces it.

When the template is deleted, replaced, unconfigured, or no longer a dependency, the old snapshot MUST be evicted. Do not determine this by rereading template content or restoring `htmlEntries`.

## Build-output preservation

The collection Loader MUST return the template bytes unchanged. During acceptance, compare the final HTML semantics/content before and after introducing the collector under identical source code and asset names, proving at minimum that:

- `<%= BASE_URL %>` expands correctly;
- `<%= htmlWebpackPlugin.options.title %>` expands correctly;
- The final HTML contains no unprocessed EJS markers;
- JS/CSS assets are injected correctly;
- The page still starts;
- Template processing outside collection is unchanged.

Internal cache keys, stats, or timing may change because of the new Loader request; such internal differences MUST NOT be mischaracterized as page behavior changes.

## Errors

- A fatal parse diagnostic for static HTML, a Loader failure, or a child compilation failure MUST enter Ticket 03's failed-round transaction.
- The error includes the template's project-relative path and original location.
- A failure MUST NOT publish partial collection output.

## Non-goals

- Do not have the Plugin read templates.
- Do not collect HTML rendered by HTMLWebpackPlugin or the final bundle.
- Do not reimplement lodash/EJS template execution.
- Do not use `templateContent` to bypass the existing Loader chain.
- Do not implement CSS or style preprocessors.
- Do not restore `htmlEntries`.

## Acceptance criteria

- [ ] The demo's raw HTML template actually passes through `myloader`, rather than being supported only in extractor unit tests.
- [ ] Static HTML text/attributes use `static-html-text` and `static-html-attribute`, respectively, and follow the entity, whitespace, allowlist, and source-range contracts.
- [ ] The HTMLWebpackPlugin template Loader runs in the correct order with `force=true`, and the collector sees the raw HTML first.
- [ ] BASE_URL, title, asset injection, and final page content continue to work correctly, with no EJS marker leakage.
- [ ] Loader snapshots from the child compiler enter the corresponding main/root compiler session and do not produce independent output or state contamination.
- [ ] The initial child compilation can collect; results are retained when a cached child does not rerun.
- [ ] After a template is deleted, replaced, or unconfigured, the old static HTML snapshot is evicted.
- [ ] The Plugin still performs no business HTML file reads or source parsing.
- [ ] A fatal static HTML error fails the entire round and preserves the old output.
- [ ] Integration tests cover a real HTMLWebpackPlugin child compilation and at least one cache-hit rebuild.
- [ ] Package tests and the demo production build pass.
