# Internationalization Collection Context

This context defines the vocabulary for collecting Chinese user-facing text from source modules during the project's build process.

## Language

**Collected text**:
Chinese text identified as candidate user-facing copy and added to the localization collection. Collection does not rewrite application source.

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
The deduplicated localization data present in the current source collection, grouped by text value and retaining every distinct source location where that value occurs. Entries without a current source location are not part of the result.

**Semantic collection stage**:
A collection point where the source structure still identifies whether text came from a script literal, HTML text or attribute, or a CSS `content` declaration.
_Avoid_: Final-bundle scan

**Resource snapshot**:
The complete collection for one currently processed source resource, submitted as a replacement for that resource's previous snapshot so removed text and locations can disappear.

**Static HTML entry**:
The source HTML document at an explicitly configured path, collected from its original template rather than from rendered build output.

**Collection configuration**:
The local configuration for collection inputs, semantic attribute rules, output files, and resource filtering; it is separate from the dependency package's translation configuration.

**Resource identity**:
The normalized project resource path plus its semantic block or resource query, used to replace one resource snapshot without overwriting another block from the same file.

**Collection failure**:
A parsing or output error that invalidates the current collection round; it preserves the previous formal output, reports the source and position, and fails the build rather than publishing a partial result.

**Collection schema**:
The stable, versioned shape of the collection result and its source map, including semantic kinds, source ranges, metadata, and entry ordering.

**Source coordinate**:
A position in original source using 1-based lines and UTF-16 code-unit columns; ranges are half-open and end-exclusive.

**Static fragment**:
A source text segment whose value can be determined without executing application code, including a segment around an interpolation; only fragments containing Chinese are collected.

**Exclusion directive**:
A syntax-valid, node-local comment marker (`no-i18n-auto`) that prevents the associated semantic node from entering the collection result.
