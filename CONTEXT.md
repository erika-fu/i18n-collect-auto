# Internationalization Collection Context

This context defines the vocabulary for project localization completeness: discovering Chinese user-facing text, distinguishing runtime-localizable messages from Chinese source audit findings, carrying messages through translation catalogs, and optionally rewriting supported source into runtime localization calls.

## Language

### Localization completeness

**Runtime-localizable message**:
A message the supported build or source replacement path can turn into a runtime `t` / `$t` lookup (today: complete static JavaScript, TypeScript, and Vue template copy, not standalone HTML or styles).
_Avoid_: Audit finding, catalog entry alone

**Runtime localization coverage**:
Whether every runtime-localizable message is already a runtime localization call or has a current source-catalog key that build or source replacement can apply; Chinese source audit findings are out of scope.
_Avoid_: Project localization completeness, collection coverage

**Chinese source audit**:
The set of Chinese user-facing findings on surfaces that are not runtime-localizable, including standalone HTML and styles until an adapter makes them runtime-localizable; these findings never receive keys or enter catalogs.
_Avoid_: Runtime localization coverage

**Audit finding**:
One Chinese source audit observation with source text, location, surface, and disposition, unresolved until accepted.
_Avoid_: Occurrence, runtime-localizable message

**Accepted audit finding**:
An audit finding migrated to a runtime-localizable surface, handled by a real adapter that makes it runtime-localizable, or suppressed by an adjacent audit ignore directive with a non-empty reason. In analysis reports, a finding suppressed that way carries disposition `intentionally-ignored` and keeps its reason visible; unresolved proven findings carry disposition `unresolved`; conservative preprocessor candidates carry disposition `needs-review` until accepted or ignored.
_Avoid_: Unresolved audit finding, silent ignore, reasonless ignore

**Project localization completeness**:
The project state with complete runtime localization coverage and no blocking Chinese source audit findings: no disposition `unresolved` and no disposition `needs-review`. Intentionally ignored findings do not block completeness.
_Avoid_: Runtime localization coverage alone, Chinese source audit alone

### Commands

**Scan**:
The workflow command whose write ownership is source analysis outputs (source catalog and analysis report).
_Avoid_: Collect

**Migrate-keys**:
The one-shot migration command that rewrites per-occurrence automatic keys into deterministic exact-text hash keys across the source-locale catalog, target catalogs, and `source-catalog.json`. It is the only command allowed to cross the usual Scan/Translate write split, and only for that migration. Conflicts write nothing.
_Avoid_: Scan, Translate

**Translate**:
The workflow command whose write ownership is target translation outputs.

**Build**:
The localization-aware build path that is read-only for localization artifacts while still allowed to rewrite in-memory modules and emitted build output.

**Check**:
The read-only workflow command that evaluates project localization completeness.

**Replace**:
The optional source-replacement command that owns application-source writes only when explicitly requested, otherwise preview-only.

### Collection and messages

**Collected text**:
Chinese text identified as candidate user-facing copy during source analysis. Analysis does not rewrite application source. Source replacement is a later, explicit command.

**Template literal**:
A JavaScript or TypeScript backtick literal. Each static Chinese segment is collected independently; interpolation expressions are not collected as copy.
_Avoid_: Template, template file

**Complete static copy**:
A user-facing message wholly represented by one statically determinable source fragment, and therefore eligible for automatic collection. A fragment around interpolation, concatenation, conditional construction, or formatting is not complete static copy.
_Avoid_: Dynamic copy, message fragment

**Structured message**:
A user-facing message whose meaning depends on inline structure such as links, emphasis, controls, or component slots, so translation must control ordering and placeholders in one explicit message. Interleaving Chinese text with those elements in markup is structured fragmentation and is not complete static copy.
_Avoid_: Rich text fragment, HTML snippet

**Explicit source message**:
A localization key whose canonical Chinese source text and placeholder contract are declared in the project-owned explicit message manifest, then referenced from a static runtime localization call. It is not automatically collected from complete static copy in source.
_Avoid_: Automatic message, hash dictionary entry

**Explicit message manifest**:
The versioned document `explicit-messages.json` beside the catalog metadata. Version 1 lists localization keys with their canonical source text. Collection reads it and does not rewrite it. Placeholder contracts are derived from that source text with the same `{identifier}` rules as other message contracts.
_Avoid_: Confirmation manifest, translation catalog

**Complete-static-copy baseline**:
The versioned document `complete-static-copy-baseline.json` beside the catalog metadata. Version 1 lists grandfathered complete-static-copy policy violations with reason, path, kind, source range, and text. Policy checks read it and do not rewrite it. Exact matches stay grandfathered; newly added or modified violations fail. The baseline does not hide analysis failures, stale formal outputs, or direct source text inside a declared runtime-multilingual boundary.
_Avoid_: Audit ignore directive (reasoned HTML/CSS suppressions), source catalog

**Explicit localization boundary**:
A feature or route that must render user-facing copy in a target locale at runtime. Its user-facing copy uses explicit localized calls rather than automatically collected source text.
_Avoid_: Translated page

**Runtime-multilingual boundaries**:
The versioned document `runtime-multilingual-boundaries.json` beside the catalog metadata. Version 1 lists named boundaries with project-relative `include` and optional `exclude` scope patterns. A path is inside a boundary when it matches that boundary's include and not its exclude; overlapping boundaries use union membership. `check-policy` rejects direct user-facing source text inside those boundaries. Being collected automatically is not the same as being able to switch languages at runtime.
_Avoid_: Translated page, complete-static-copy baseline

**HTML text**:
A user-visible HTML text-node fragment considered independently (formatting-only edge whitespace excluded; meaningful internal whitespace kept; no merge across elements; character references decoded with ranges on the original spelling). Vue template text may be runtime-localizable; standalone HTML text is a Chinese source audit finding until an adapter exists.

**User-facing HTML attribute**:
An allowlisted HTML attribute presented to users or assistive technology (`title`, `placeholder`, `alt`, `aria-label`, `value`, and peers); static values decode directly, dynamic bindings contribute only statically determinable fragments. Vue attributes may be runtime-localizable; standalone HTML attributes are Chinese source audit findings until an adapter exists.

**CSS generated content**:
Chinese text in a CSS `content` declaration that may render as generated user-visible content; statically determinable string fragments qualify, and until an adapter exists these findings are Chinese source audit findings with semantic kind `css-generated-content`.

**CSS preprocessor candidate**:
A conservative style-audit observation from SCSS, indented Sass, Less, or Stylus lightweight source scanning (no import, variable, function, mixin, or interpolation execution). It is reported as disposition `needs-review` with semantic kind `css-preprocessor-candidate` rather than claimed as proven generated content.
_Avoid_: CSS generated content, Style IR collection entry

**Source range**:
A half-open range covering the collected fragment's original content, with 1-based line numbers and 0-based columns; the end position is exclusive. For HTML attributes and CSS strings, the range excludes the attribute syntax and string delimiters.

**Source location**:
The originating file, semantic kind, and source range associated with collected text.

**Semantic kind**:
The fixed category identifying where collected text came from: `script-string`, `template-literal`, `html-text`, `html-attribute`, `template-expression`, `css-generated-content`, `css-preprocessor-candidate`, `static-html-text`, or `static-html-attribute`. A static fragment inside a dynamic HTML attribute remains `html-attribute`.

**Collection result**:
The runtime-localizable messages in the current source analysis; equal exact source text shares one automatic key unless an explicit key is required, and Chinese source audit findings stay outside the catalog.

**Occurrence**:
One concrete appearance of collected text in source, with its own source location, that shares an automatic key with equal exact source text unless an explicit key is required for contextual translation.

**Semantic collection stage**:
A collection point where the source structure still identifies whether text came from a script literal, HTML text or attribute, or a CSS `content` declaration.
_Avoid_: Final-bundle scan

**Resource snapshot**:
The complete collection for one currently processed source resource, submitted as a replacement for that resource's previous snapshot so removed text and locations can disappear.

**Static HTML entry**:
The source HTML document at an explicitly configured path, analyzed from its original template as a Chinese source audit surface until an adapter makes its messages runtime-localizable.

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
The stable runtime identifier used by source replacements and translation catalogs. An automatic key is derived when no adjacent key directive explicitly supplies one; otherwise the key is explicit.

**Key directive**:
A syntax-valid comment `i18n-key: <key>` that gives the next associated collected fragment an explicit localization key. It associates by the same rules as the exclusion directive. A comment that starts with `i18n-key` but is not well formed fails the analysis round.

**Automatic key**:
A deterministic hash of exact source text used when no adjacent key directive supplies a key; equal exact text shares one key, contextual differences need an explicit key, and unequal-text hash collisions fail closed.
_Avoid_: Per-occurrence automatic key, `auto.<ULID>`, occurrence identity, structural anchor, derived key

**Derived key**:
A retired localization-key strategy computed from the resource path, the semantic kind, and the collected text. It is not used by the current model.
_Avoid_: Automatic key

**Message pattern**:
The normalized shape of collected source text used when comparing occurrences that share a localization key. Today the literal static text is kept as-is except that simple `{identifier}` tokens become positional slots; whitespace, ICU selects, and non-identifier braces are not folded.

**Placeholder contract**:
The ordered list of placeholder names taken from those `{identifier}` tokens in the source text. Two messages with the same pattern but different names are incompatible.

**Message contract**:
The pair of a message pattern and its placeholder contract. Occurrences may share one localization key only when their message contracts match.

**Key conflict**:
One localization key that names incompatible message contracts. It fails the collection round before publication and reports every location of each conflicting source text.

**Source fingerprint**:
A hash of a key's source text recorded in catalog metadata. A key whose fingerprint differs between two catalogs has source-changed text.

**Catalog metadata**:
The per-key record beside the source-locale catalog (source text, fingerprint, explicit or automatic origin, representation, source locations), recovering automatic keys from exact source text rather than per-occurrence identity.

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
A syntax-valid, node-local comment marker (`no-i18n-auto`) that prevents the next associated collected text or static fragment from entering the collection result. The directive is control metadata; its own comment text is not collected. Ordinary comments are not collected. It is not an audit ignore directive: exclusion drops runtime-localizable collection candidates rather than accepting a Chinese source audit finding.
_Avoid_: Audit ignore directive, `i18n-ignore`

**Audit ignore directive**:
A syntax-valid, node-local comment `i18n-ignore: <non-empty reason>` on a Chinese source audit surface (standalone HTML, standard CSS, or supported style preprocessors) that accepts exactly the next associated audit finding. The finding remains in the analysis report as an accepted audit finding with disposition `intentionally-ignored` and the stated reason. A comment that starts with `i18n-ignore` but lacks a non-empty reason, associates to no finding, or associates ambiguously fails the analysis round.
_Avoid_: Exclusion directive, `no-i18n-auto`, silent ignore, reasonless ignore, complete-static-copy baseline

**Existing translation**:
Target-locale catalog text already stored for a localization key. Translate keeps that text unless the caller sets `--retranslate`. The kept text may be a human translation or an earlier translation draft that was already accepted. A source-text change keeps the text and sets its review state to `needs-review`.

**Stale target key**:
A localization key present in a target catalog but absent from the current source catalog; reported, not a completeness failure by itself, and removed only by explicit prune.

**Replacement adapter**:
The runtime call shape for source or build replacement (`vue2`, `vue3`, or `js`), naming the positions it can rewrite and requiring an already-present runtime integration; standalone HTML and styles remain audit surfaces until such an adapter exists.

**Replacement preview**:
The dry-run result of source replacement: per-file proposed source, skips, and already-localized calls, with no artifact writes.

**Source replacement**:
A rewrite of a supported runtime-localizable location into a runtime localization call; preview by default, source written only on explicit request.

**Build replacement**:
A build-time rewrite of a supported runtime-localizable location into a runtime localization call in memory and emitted output only, with Vue edits applied to original template text and attributes before template compilation so locale changes keep static optimizations correct.
