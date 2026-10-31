# Internationalization Collection Context

This context defines the vocabulary for collecting Chinese user-facing text from source modules and for carrying that text through translation catalogs, translation providers, and source replacement.

## Language

**Collected text**:
Chinese text identified as candidate user-facing copy and added to the localization collection. Collection does not rewrite application source. Source replacement is a later command.

**Template literal**:
A JavaScript or TypeScript backtick literal. Each static Chinese segment is collected independently; interpolation expressions are not collected as copy.
_Avoid_: Template, template file

**HTML text**:
A user-visible HTML text-node fragment. Each text node is considered independently: formatting-only leading and trailing whitespace is excluded, meaningful internal whitespace is retained, and text is not merged across element boundaries. Character references contribute their decoded character value while the source range remains anchored to the original spelling.

**User-facing HTML attribute**:
An HTML attribute whose value may be presented to a user or assistive technology, such as `title`, `placeholder`, `alt`, `aria-label`, or `value`. Only the agreed attribute allowlist qualifies as collected copy. A static attribute contributes its decoded value; a dynamic binding contributes each statically determinable fragment without evaluating the expression.

**CSS generated content**:
Chinese text in a CSS `content` declaration that may be rendered as generated user-visible content. Every statically determinable string fragment in the declaration qualifies, including fragments mixed with dynamic CSS values; empty strings, whitespace-only strings, other declarations, custom-property definitions, selectors, and comments do not qualify.

**Source range**:
A half-open range covering the collected fragment's original content, with 1-based line numbers and 0-based columns; the end position is exclusive. For HTML attributes and CSS strings, the range excludes the attribute syntax and string delimiters.

**Source location**:
The originating file, semantic kind, and source range associated with collected text.

**Semantic kind**:
The fixed category identifying where collected text came from: `script-string`, `template-literal`, `html-text`, `html-attribute`, `template-expression`, `css-generated-content`, `static-html-text`, or `static-html-attribute`. A static fragment inside a dynamic HTML attribute remains `html-attribute`.

**Collection result**:
The localization data present in the current source collection, containing every collected occurrence independently. Equal source text does not cause occurrences to share a localization key unless they explicitly name the same key. Entries without a current source location are not part of the result.

**Occurrence**:
One concrete appearance of collected text in source. It has its own source location and may be independently located, replaced, and matched to collection history. An occurrence is not necessarily a translation unit.

**Semantic collection stage**:
A collection point where the source structure still identifies whether text came from a script literal, HTML text or attribute, or a CSS `content` declaration.
_Avoid_: Final-bundle scan

**Resource snapshot**:
The complete collection for one currently processed source resource, submitted as a replacement for that resource's previous snapshot so removed text and locations can disappear.

**Static HTML entry**:
The source HTML document at an explicitly configured path, collected from its original template rather than from rendered build output.

**Collection configuration**:
The local configuration for collection inputs, semantic attribute rules, output files, resource filtering, and optional collection-context filters; it is separate from the dependency package's translation configuration.

**Scope pattern**:
A project-relative file or directory boundary, or a project-relative glob, listed in `include` or `exclude`. An `exclude` pattern vetoes a resource even when an `include` pattern also matches.

**Collection-context filter**:
An optional category in collection configuration: `logging`, `tests`, or `analytics`. Each filter is off unless the project selects it. A selected filter omits candidates in that context. It is a project policy, and collection stays inclusive when no filter is selected.

**Translation catalog**:
A locale-specific mapping from localization keys to translated text, derived from collected text and maintained separately for each locale. The default external representation is a flat JSON mapping, while format adapters may emit other consumer formats.

**Translation provider**:
A project-supplied integration that produces translation drafts for requested source text and target locales. It is optional and independent of collection.

**Translation draft**:
The text a translation provider proposes for one localization key in one target locale. It becomes catalog text only when the translate command accepts it.

**Review state**:
The per-key, per-target-locale record of the source fingerprint a translation was accepted against, and whether that translation is current or needs review. It is stored beside the catalogs and is not part of the source-locale catalog metadata.

**Localization key**:
The stable runtime identifier used by source replacements and translation catalogs. A location-derived key is generated when no adjacent key directive explicitly supplies one.

**Key directive**:
A syntax-valid comment `i18n-key: <key>` that gives the next associated collected fragment an explicit localization key. It associates by the same rules as the exclusion directive. A comment that starts with `i18n-key` but is not well formed fails the collection round.

**Automatic key**:
A localization key assigned to an occurrence when no adjacent key directive supplies one. Its readable semantic slug is only a diagnostic hint; its stable ID is assigned once and reused through catalog metadata rather than being recalculated from current source text or coordinates.

**Structural anchor**:
The stable source-structure description used to identify an occurrence across collection rounds. It names the nearest meaningful semantic host and the occurrence's child role; local context distinguishes otherwise identical sibling occurrences. Coordinates aid locating source but do not independently establish identity.

**Derived key**:
A legacy localization key computed from the resource path, the semantic kind, and the collected text. It does not depend on line or column. New automatic keys replace this strategy because equal text in separate occurrences must not share a translation identity by default.

**Key conflict**:
One localization key that names two different source texts. It fails the collection round and reports every location of each text.

**Source fingerprint**:
A hash of a key's source text recorded in catalog metadata. A key whose fingerprint differs between two catalogs has source-changed text.

**Catalog metadata**:
The per-key record next to the source-locale catalog: source text, source fingerprint, explicit or derived origin, source locations, and per-occurrence identity. Each occurrence records a stable ID, semantic host, child role, local context, and source location. The metadata document is versioned; unsupported versions fail with a clear migration path rather than publishing a partial upgrade.

**Resource identity**:
The normalized project resource path plus its semantic block or resource query, used to replace one resource snapshot without overwriting another block from the same file.

**Collection failure**:
A parsing or output error that invalidates the current collection round; it preserves the previous formal output, reports the source and position, and fails the build rather than publishing a partial result.

**Collection schema**:
The stable, versioned shape of the collection result and its source map, including semantic kinds, source ranges, metadata, and entry ordering.

**Source coordinate**:
A position in original source. Lines are 1-based. Columns are 0-based and count UTF-16 code units. A source range is half-open: the end coordinate is exclusive.

**Static fragment**:
A source text segment whose value can be determined without executing application code, including a segment around an interpolation; only fragments containing Chinese are collected.

**Exclusion directive**:
A syntax-valid, node-local comment marker (`no-i18n-auto`) that prevents the next associated collected text or static fragment from entering the collection result. The directive is control metadata; its own comment text is not collected. Ordinary comments are not collected.

**Existing translation**:
Target-locale catalog text already stored for a localization key. Translate keeps that text unless the caller sets `--retranslate`. The kept text may be a human translation or an earlier translation draft that was already accepted. A source-text change keeps the text and sets its review state to `needs-review`.

**Hash collection output**:
The hash dictionary and its source map written by collection. The dictionary maps the MD5 of collected text to that text. It stays beside the translation catalog during migration. Source replacement does not use the hash as a localization key.

**Replacement adapter**:
The runtime call shape used by source replacement: `vue2`, `vue3`, or `js`. Each adapter states the semantic positions it can rewrite and requires a runtime integration that is already present. It does not install dependencies or rewrite application bootstrap. React JSX, standalone HTML, and CSS generated content are outside its scope.

**Replacement metadata**:
The versioned record of committed source replacements, stored as `replacements.json` beside the translation catalogs. A write prepares the changed source files, the keyed catalogs, and this record, then commits them as one set. A failed commit restores that set.

**Replacement preview**:
The dry-run result of source replacement. It reports the per-file source that would be written, the skipped candidates, and the calls that are already localized. It does not modify source files, translation catalogs, or replacement metadata.

**Source replacement**:
A rewrite of a supported collected location into a runtime localization call that names its localization key. Collection does not do this. The replace command's default is a replacement preview. Source files change only when the caller sets `--write`.
