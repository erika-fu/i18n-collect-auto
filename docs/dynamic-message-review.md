# Dynamic Message Review

## Status

Accepted design; command-line review support is pending implementation. Until it is implemented, the generated analysis report remains the source of candidates and developers must perform the equivalent decisions manually.

## Purpose

Collection must make every discovered user-facing Chinese occurrence locatable without pretending that every occurrence is already a safe translation unit. Complete static copy can be collected and optionally replaced automatically. Dynamic or structured copy must be discovered as a review candidate, then receive an explicit human decision before it can become a translatable message.

## Implementation status

### Implemented today

- Complete static copy is collected into the source catalog and can be replaced when the selected workflow supports that source surface.
- Valid explicit localization calls are validated against `explicit-messages.json`, enter the source catalog as explicit messages, and retain call locations and occurrences.
- The complete-static-copy policy detects interpolation, concatenation, conditionals, formatting, and structured fragmentation. It currently writes **fragment-level** `explicitRequiredFindings` and causes `check` to fail.
- Webpack `collect --replace` handles Vue through compiler-generated render-function JavaScript. The separate `replace --write` workflow rewrites original `.vue` source and template ranges.

### Accepted but not implemented

1. Replace fragment-level `explicitRequiredFindings` for complex copy with a **whole-expression dynamic message candidate**.
2. Give each candidate a stable review identifier, expression text, static-fragment evidence, whole-expression location, semantic context, and diagnostic reason.
3. Add `dynamic-message-decisions.json` as the version-controlled input for translate, intentionally-ignore, and defer decisions.
4. Make `collect` read that decision manifest, validate that each decision still matches its candidate, and regenerate the candidate disposition in `analysis-report.json`.
5. Add `i18n-collect review` in interactive and non-interactive forms.
6. Extend `check` so project policy evaluates unresolved or deferred dynamic candidates instead of treating every complex-copy finding as an unconditional explicit-required failure.
7. Support `review --write` for proven-safe source migrations. In interactive use it shows the diff and requires confirmation; in non-interactive use `--yes` confirms the already-explicit write intent. It must not guess how to rewrite arbitrary dynamic expressions.

## Classification

| Source form | Classification | Catalog and replacement behavior |
| --- | --- | --- |
| A complete static user-facing literal | Automatic message | Assign an automatic exact-text key; record it in `source-catalog.json`; optionally replace it during the same collection pass. |
| A valid explicit localization call | Explicit message | Validate its key and placeholder contract against `explicit-messages.json`; record the message and call occurrence in `source-catalog.json`; do not rewrite the existing call. |
| Interpolation, concatenation, conditional construction, dynamic key construction, plural or formatting logic, or rich-text/component structure | Dynamic message candidate | Record the whole expression, location, context, and reason in `analysis-report.json`; do not add fragments to a translation catalog and do not automatically replace it. |
| Chinese on an unsupported static surface such as standalone HTML or styles | Chinese source audit finding | Keep it in the audit report; it has no runtime key or catalog entry until a real adapter makes that surface runtime-localizable. |

A static fragment inside a dynamic expression is evidence for a candidate, not an independently translatable message. For example, neither `已选择 ` nor ` 个文件` is a catalog message in `'已选择 ' + count + ' 个文件'`.

## Location model

Every discovered user-facing Chinese fact retains a source location. The purpose depends on the classification:

- During a collection pass, AST or template ranges are the immediate inputs for safe replacement edits.
- Automatic and explicit messages retain `locations` and `occurrences` in `source-catalog.json` as durable source evidence, lifecycle information, and diagnostic context. They are not deferred replacement instructions.
- Dynamic message candidates retain the location of the whole expression in `analysis-report.json` so a reviewer can inspect and migrate it.
- Audit findings retain locations for disposition and policy diagnostics.

`explicit-messages.json` is the authority for an explicit key's canonical source text and placeholder contract. `source-catalog.json` is the collected view of all confirmed runtime-localizable messages—both automatic (`origin: "derived"`) and explicit (`origin: "explicit"`)—and of their source occurrences.

## Dynamic candidate shape

The exact schema may evolve, but each candidate must carry a stable review identifier and enough context for a human decision:

```json
{
  "id": "dynamic.7a4e91",
  "expression": "'已选择 ' + count + ' 个文件'",
  "staticFragments": ["已选择 ", " 个文件"],
  "location": {
    "path": "src/upload.ts",
    "start": { "line": 12, "column": 17 },
    "end": { "line": 12, "column": 43 }
  },
  "sourceSurface": "script",
  "semanticRole": "dynamic-message",
  "capability": "explicit-localization-required",
  "disposition": "needs-review",
  "diagnostic": "String concatenation constructs user-facing copy and cannot be safely translated as fragments."
}
```

The candidate identifier is a stable review identity derived from the occurrence and expression fingerprint; it is never a localization key.

## Human decisions

A decision is a version-controlled project input, not a field manually maintained in the generated report. The planned `dynamic-message-decisions.json` records the candidate identity, disposition, and a non-empty reason where needed. `collect` reads that input and regenerates the resulting disposition in `analysis-report.json`.

| Decision | Result |
| --- | --- |
| **Translate** | Define an explicit key and canonical source in `explicit-messages.json`, then migrate the source to an explicit localization call. The next collection records it as an explicit catalog message. |
| **Intentionally ignore** | Keep the candidate visible with `disposition: "intentionally-ignored"` and a reason. It does not become a translation message. |
| **Defer** | Keep `disposition: "needs-review"` with an optional reason. CI may warn or fail according to project policy. |

A reviewed candidate is not complete merely because a decision file mentions it: the next collection must verify the source still matches the candidate and must reject stale or ambiguous decisions.

## Planned command-line interface

The planned `review` command provides both interactive and scriptable decisions. It must not be documented as implemented until the CLI exists.

```bash
# List unresolved dynamic candidates.
i18n-collect review --status needs-review

# Inspect one candidate interactively and choose translate, ignore, or defer.
i18n-collect review dynamic.7a4e91

# Make an auditable non-interactive decision.
i18n-collect review dynamic.7a4e91 --ignore \
  --reason "China-only legal notice" --yes

# Record an explicit-message migration without rewriting source.
i18n-collect review dynamic.7a4e91 --translate \
  --key upload.selectedFiles \
  --source '已选择 {count} 个文件' --yes

# Only after a shown diff and explicit confirmation, apply a supported migration.
i18n-collect review dynamic.7a4e91 --translate \
  --key upload.selectedFiles \
  --source '已选择 {count} 个文件' --apply
```

`--write` is intentionally separate from recording the decision. Dynamic expressions vary by framework and semantics, so the tool must reject rewrites it cannot prove safe. For supported patterns, however, writing the approved explicit-localization migration is the normal purpose of write mode: it shows the diff and requires confirmation before writing source.

## Example lifecycle

```text
'已选择 ' + count + ' 个文件'
  → collect records a needs-review dynamic candidate with its location
  → reviewer chooses Translate and approves: 已选择 {count} 个文件
  → explicit-messages.json defines upload.selectedFiles
  → source becomes t('upload.selectedFiles', { count })
  → the next collect removes the candidate and records an explicit catalog occurrence
```

This workflow ensures that all visible Chinese is discoverable and locatable, that only complete messages are translated, and that no dynamic expression is silently ignored or incorrectly split into fragments.
