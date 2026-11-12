# Webpack Runtime Collection and Build Replacement Design

## Status

Implemented for Webpack runtime collection and build replacement. Filesystem `scan` remains an intentional non-Webpack / legacy analysis path beside `collect` (see CONTEXT.md and docs/migration.md); it is not a second runtime-collection authority.

## Decision Summary

Runtime-localizable messages are discovered from the **Webpack module graph**. Webpack is the source of truth for which runtime modules are reachable, how they are resolved, and how Vue SFCs are compiled.

Build-time replacement is an optional Webpack transformation that consumes the same compilation's collection result and rewrites only in-memory modules and emitted bundles. It never writes application source files.

Translation remains a separate workflow. Standalone HTML and styles remain Chinese source audit surfaces: they are reported but do not receive runtime keys, enter translation catalogs, or participate in build replacement.

```text
Webpack compilation / watch
  ├─ discover runtime-localizable messages from live modules
  ├─ optionally rewrite safe messages in memory
  ├─ aggregate live resource snapshots
  └─ publish or verify collection outputs

Translate
  └─ read source catalog and update target-locale catalogs independently
```

## Goals

- Make the real Webpack module graph the sole source of truth for runtime message discovery.
- Support incremental collection in Webpack watch and development-server compilations.
- Collect and optionally replace JavaScript and compiled Vue template render code through a shared JavaScript AST pipeline.
- Preserve an HTML attribute allowlist for user-facing properties.
- Keep Chinese text in standalone HTML and styles visible through audit reporting without pretending it is runtime-localizable.
- Keep translation, external network access, API credentials, and target-catalog lifecycle outside compilation.
- Keep source replacement out of scope for this design.

## Non-goals

- Editing application source files.
- Treating every Chinese string in generated render code as user-facing copy.
- Providing build replacement for standalone HTML or CSS.
- Sending translation requests from loaders, watch mode, or a normal production compilation.
- Reproducing Webpack resolution and loader behavior with a filesystem-only scanner.
- Supporting non-Webpack bundlers in the initial implementation.

## Runtime Collection Boundary

### Webpack module graph

A runtime message is eligible for automatic collection only when it belongs to a module that is live in the current Webpack compilation.

```text
Webpack entry
  → resolve / alias / loader rules / conditional imports
  → live module graph
  → runtime-localizable messages
```

This boundary gives collection the same behavior as the actual application build. It respects entries, aliases, loader configuration, dependency reachability, and Webpack's invalidation model.

### Incremental snapshots

Each participating module or resource block submits a complete snapshot for that resource in a compilation round.

```text
resource identity
  → complete current findings
  → resource snapshot
```

At compilation completion, collection is rebuilt from the live modules' latest snapshots, rather than incrementally appending historical findings.

```text
live modules
  → current snapshots
  → aggregate collection result
  → source catalog and analysis report
```

Consequences:

- A new reachable module adds its findings.
- An edited module replaces its previous findings.
- A deleted or no-longer-reachable module disappears from the aggregate result.
- Watch mode updates collection artifacts after the affected compilation, without requiring a separate scan command.

## Transformation Timing

Collection must not use loader `pitch` as its primary mechanism. A pitch hook runs before the normal loader chain and encourages rereading the source file from disk instead of consuming the source flowing through compilation.

The primary collection and replacement transforms run in normal loader phases at the semantic boundary appropriate to the module:

| Surface | Analysis and optional replacement boundary |
| --- | --- |
| JavaScript / TypeScript | Before Babel transforms the source |
| Vue script / script setup | As JavaScript before Babel transforms the source |
| Vue template | After Vue compiles the template to render-function JavaScript |
| Vue style | Audit only |
| Standalone HTML / CSS | Audit only |

For normal JavaScript, the loader chain is conceptually:

```text
raw JS / TS
  → i18n JavaScript transform
  → babel-loader
  → remaining loaders and bundle generation
```

The i18n transform consumes the loader source; it does not reread the resource from disk as its normal path.

## JavaScript Analysis and Replacement

JavaScript and TypeScript use one AST analysis pipeline.

```text
JavaScript AST
  → semantic findings
      ├─ collection snapshot
      └─ optional build-replacement edit plan
```

The two outputs are distinct responsibilities:

- **Collection** answers which runtime-localizable messages exist, their keys, source text, semantic roles, and diagnostics.
- **Build replacement** answers whether a collection finding can safely be rewritten for the configured runtime adapter in this compilation.

The replacement sink is enabled only for a build-replacement mode. Collection does not require replacement, and replacement must not invent an independent key scheme or independently rediscover messages.

Build replacement changes only loader-provided in-memory source and emitted assets. Application files on disk remain unchanged.

## Vue Templates Through Render Functions

Vue templates are not edited as original template source in this design. Instead, Vue compilation produces render-function JavaScript, which is then processed through the JavaScript AST pipeline.

```text
Vue template
  → vue-loader / Vue compiler
  → render-function JavaScript
  → i18n JavaScript analysis and optional replacement
```

This avoids a template-source rewriter that must directly manage `v-bind`, ordinary attributes, directives, interpolations, slots, and template-coordinate edits.

### Render-function policy

The implementation must not collect every Chinese string in render output. It recognizes only statically safe, known user-facing positions in supported Vue compiler output.

Initial safe positions include:

- text-child arguments in known Vue VNode helper call shapes;
- static string values of allowlisted properties in a simple VNode props object;
- statically known values in other explicitly supported VNode helper positions.

It must ignore or conservatively decline:

- HTML tag names;
- property names, event names, directive names, slot names, component names, and compiler helper arguments;
- object spreads;
- merged or conditional props;
- dynamic props and dynamic children;
- unrecognized helper call forms;
- SSR- or optimization-specific shapes not explicitly supported.

Unsupported or ambiguous render forms must be skipped or reported as requiring explicit handling; they must not be silently rewritten.

### Attribute allowlist

The existing user-facing HTML attribute allowlist remains the shared policy.

```js
attributeAllowlist: [
  'title',
  'placeholder',
  'alt',
  'aria-label',
  'value'
]
```

For a template such as:

```vue
<input placeholder="Enter a name" aria-label="Name input" data-test="input-id">
```

Vue render output is expected to contain a VNode props object similar to:

```js
_createElementVNode('input', {
  placeholder: 'Enter a name',
  'aria-label': 'Name input',
  'data-test': 'input-id'
})
```

The render-function policy collects and may replace `placeholder` and `aria-label`, while ignoring `data-test`. The policy is based on property keys in the props object, not on parsing original template attribute syntax.

## Keys and Findings

Runtime-localizable messages retain the project key model:

- Equal exact source text shares a deterministic automatic key when no explicit key is required.
- An explicit key may be supplied for context-sensitive translation or structured messages.
- Key conflicts fail collection rather than publishing an ambiguous catalog.
- Existing localized calls are validated against declared or automatic message contracts.

A runtime finding retains the information needed within the compilation to safely transform the in-memory module:

```text
key
source text
semantic role
resource identity
AST range or edit location
replacement capability
```

Long-lived source-edit coordinates are not required by this design because source replacement is out of scope. Reports may still expose useful source locations when compiler source maps or module metadata make them available.

## Build Replacement

Build replacement is a Webpack-only operation.

```text
current compilation collection result
  → safe replacement plan
  → in-memory loader source edits
  → normal compilation
  → emitted bundle containing t(key) / $t(key)
```

Replacement must use the same compilation's message findings whenever collection is enabled. It must not perform an unrelated filesystem scan to rederive keys or occurrence locations.

The runtime adapter defines the safe call shape and helper injection behavior for supported JavaScript, Vue 2, and Vue 3 output. Unsafe occurrences fail the build or are explicitly reported according to the selected replacement policy; they must not silently produce broken code.

## Collection Outputs

Collection produces two distinct formal outputs:

- `source-catalog.json`: runtime key to canonical Chinese source text; this is the input for translation and source-locale runtime lookup.
- `analysis-report.json`: runtime findings, audit findings, diagnostics, coverage, and explicit-handling requirements.

### Command modes and output ownership

The desired modes are:

```bash
# One Webpack collection compilation; publishes collection outputs.
i18n-collect collect --webpack-config webpack.config.js

# Webpack watch; publishes updated collection outputs for each successful round.
i18n-collect collect --webpack-config webpack.config.js --watch

# Independent translation workflow.
i18n-collect translate --allow-network

# Webpack build replacement. Normally verifies formal collection outputs.
i18n-collect build --webpack-config webpack.config.js
```

Recommended ownership policy:

| Mode | Collection outputs | Bundle |
| --- | --- | --- |
| `collect` | publish | optional / disposable compilation output |
| `collect --watch` | publish after successful rounds | development output as configured |
| production `build` | verify against the current compilation by default | publish |
| explicit development build-write mode | publish when explicitly enabled | publish |

A production build should normally fail when the checked-in collection result differs from the current compilation, rather than silently creating uncommitted localization changes. A deliberately enabled development mode may publish collection outputs as part of a build.

## Translation Is Independent

Translation does not run inside a Webpack loader, compilation, or watch loop.

```text
source-catalog.json
  → translation provider
  → target-locale catalogs and translation state
```

The translation workflow owns:

- provider integration;
- external API calls;
- API-key access through environment variables or the host project's secret mechanism;
- network authorization;
- target locale selection;
- retry/failure policy;
- retranslation and pruning;
- source fingerprint and review-state lifecycle.

API keys must not be stored in collection configuration, source catalogs, analysis reports, or emitted bundles.

## Static HTML and Style Audits

Standalone HTML and styles are not runtime-localizable in this design because they do not have the JavaScript i18n runtime context required for `t(key)` or `$t(key)`.

```text
standalone HTML / CSS
  → audit finding
  → analysis report
  → no runtime key
  → no source catalog entry
  → no translation request
  → no build replacement
```

### Standalone HTML

Audit candidates include:

- visible static text nodes;
- static values of allowlisted user-facing attributes.

They exclude comments, scripts, structural attributes such as `class`, `id`, and `data-*`, and dynamic forms that cannot be statically understood.

### Styles

Audit candidates include:

| Surface | Finding |
| --- | --- |
| Standard CSS `content: "Chinese text"` | proven unresolved audit finding |
| SCSS, Sass, Less, Stylus possible visible Chinese text | conservative `needs-review` finding |
| Vue style blocks | same audit policy |

Selectors, variable names, and comments are not user-facing copy candidates.

An audit finding may be resolved by moving the content to a runtime-localizable surface, by a future real static-resource adapter, or by an adjacent reasoned audit-ignore directive.

### Static resources outside the module graph

Webpack does not necessarily include `public/index.html` or unimported styles in its module graph. They need an explicit, separate audit input rather than being silently mixed into runtime collection.

A possible configuration shape is:

```js
module.exports = {
  staticAudit: {
    include: [
      'public/**/*.html',
      'legacy/**/*.css',
      'legacy/**/*.scss'
    ]
  }
}
```

The separation is intentional:

```text
Webpack module graph → runtime collection and build replacement
staticAudit.include  → read-only HTML/CSS audit findings
```

## Conflicts Closed By The Implementation

These pre-migration conflicts no longer describe the repository:

| Former behavior | Closed by |
| --- | --- |
| loader `pitch` disk rereads | Normal-phase loader transforms; pitch probe helpers removed |
| Webpack collection plugin removed | Restored `MyI18nPlugin` lifecycle integration |
| build replacement via filesystem reanalysis | Compilation analysis findings drive replacement |
| `scan` as the only formal publisher | `collect` publishes; `scan` stays legacy analysis-only |
| build never publishes collection artifacts | Default verifies; `--write-collection` is explicit |

A successful Webpack collection compilation is the authority that may publish formal runtime-collection outputs; production build mode normally verifies rather than publishes.

## Implementation Boundaries

The implementation should be staged around these boundaries:

1. Restore a formal Webpack collection integration that aggregates live module snapshots at compilation completion.
2. Replace pitch-based disk reads with normal-phase JavaScript collection transforms.
3. Add render-function recognition policy and integration tests for each supported Vue compiler/version mode.
4. Route JS and recognized render-function findings into the same key and collection-result pipeline.
5. Make build replacement consume the same compilation result rather than rerunning a filesystem analysis.
6. Introduce explicit collection publish versus verify modes for collect, watch, development build, and production build.
7. Preserve translation as an independent consumer of published source catalogs.
8. Add an explicitly configured static-audit path for HTML/CSS outside the module graph.

## Final Principle

> Runtime messages come from the Webpack module graph; JavaScript and Vue render functions share a JavaScript AST pipeline; HTML attribute allowlists remain in effect; build replacement changes only in-memory modules and bundles; standalone HTML and styles are audit-only; and translation remains independent of compilation.
