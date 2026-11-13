# Dynamic Message Review

## Status

Implemented. Collection reports whole-expression **dynamic message candidates**; **Review** records decisions in the **dynamic message decision manifest**; proven-safe `--write` migrates supported expressions; **Check** evaluates candidate dispositions as part of **project localization completeness**.

## Purpose

Collection must make every discovered user-facing Chinese occurrence locatable without pretending that every occurrence is already a safe translation unit. **Complete static copy** can be collected and optionally replaced automatically. Dynamic or structured copy is discovered as a **dynamic message candidate**, then receives an explicit human decision before it can become a **runtime-localizable message**.

## Workflow

1. **Collect** (or filesystem **Scan**) discovers candidates and regenerates dispositions from `dynamic-message-decisions.json` into `analysis-report.json`.
2. **Review** lists unresolved candidates and records translate, intentionally-ignore, or defer decisions. Translate writes the decision manifest and **explicit message manifest** (`explicit-messages.json`) atomically.
3. After Translate, **Review `--write`** (with `--adapter` and confirmation) migrates only proven-safe expressions to explicit localization calls and marks matching decisions `migrated`.
4. Re-**collect**, then **check**. Candidates still `needs-review` (including never-reviewed) and candidates still `translation-approved` (awaiting verified source migration) block completeness by default; deferred candidates follow `deferredDynamicCandidates` (`error` by default, or `warn`).

Superseded: fragment-level `explicitRequiredFindings` and any competing `--apply` write flag. Those are not part of the supported product.

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

Each candidate carries a stable review identifier and enough context for a human decision:

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

Analysis coverage summarizes candidates under `coverage.dynamicMessageCandidates` (`total`, `needsReview`, `intentionallyIgnored`, `translationApproved`, `deferred`, and related migrated counts). That summary is distinct from runtime-localization coverage and Chinese source audit coverage.

## Human decisions

A decision is a version-controlled project input in `dynamic-message-decisions.json`, not a field manually maintained in the generated report. Collection reads that input and regenerates the resulting disposition in `analysis-report.json`.

| Decision | Result |
| --- | --- |
| **Translate** | Define an explicit key and canonical source in `explicit-messages.json`, record `decision: "translate"`, and keep the live candidate as `disposition: "translation-approved"` until source is migrated. |
| **Intentionally ignore** | Keep the candidate visible with `disposition: "intentionally-ignored"` and a non-empty reason. It does not become a translation message. |
| **Defer** | Keep `disposition: "needs-review"` with an optional reason and `decision: "defer"`. Completeness treats deferred candidates per `deferredDynamicCandidates` (`error` by default). |

After a verified proven-safe `--write`, the decision record becomes terminal `decision: "migrated"` and the live candidate disappears. `review --prune` may remove eligible migrated terminals only; it never removes active translate, ignore, or defer decisions.

A reviewed candidate is not complete merely because a decision file mentions it: the next collection must verify the source still matches the candidate and must reject stale or ambiguous decisions.

## Command-line interface

```bash
# List unresolved dynamic candidates (default --status needs-review).
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

# After Translate (or combined with --translate), preview and write a proven-safe migration.
i18n-collect review dynamic.7a4e91 --write --adapter js --yes
```

Mutating decisions, prune, and `--write` require confirmation (`--yes` non-interactively). `--bulk` applies a compatible decision to every matching unresolved occurrence while persisting one decision per occurrence. `--write` is the only source-write flag; `--apply` is rejected.

### Proven-safe `--write` boundary

Supported for automatic source writing: side-effect-free string concatenation and template literals whose interpolations yield mechanically derivable named placeholders, for adapters `js`, `vue2`, and `vue3`.

Refused (decision and review remain available; source is unchanged): conditional construction, dynamic keys, plural or formatting logic, rich text / structured messages, and any expression the tool cannot prove safe. Refusal is not a guessed rewrite.

## Completeness policy

`check` evaluates dynamic message candidate dispositions separately from Chinese source audit findings and target-translation `needs-review` state:

- Candidates with disposition `needs-review` that were never decided, and candidates still `translation-approved` awaiting source migration, block completeness.
- Deferred candidates (`decision: "defer"`) fail when `deferredDynamicCandidates` is `"error"` (default), or are reported without failing when set to `"warn"`. Never-reviewed candidates are never silently waived by that setting.
- Intentionally ignored candidates stay visible with their reason and do not block completeness.

## Example lifecycle

```text
'已选择 ' + count + ' 个文件'
  → collect records a needs-review dynamic candidate with its location
  → reviewer chooses Translate: 已选择 {count} 个文件
  → explicit-messages.json defines upload.selectedFiles; candidate becomes translation-approved
  → review --write --adapter js migrates source to t('upload.selectedFiles', { count })
  → the next collect verifies the migrated decision and removes the live candidate
  → check passes for that candidate once coverage and translations are otherwise complete
```

This workflow keeps all visible Chinese discoverable and locatable, translates only complete messages, and never silently ignores a dynamic expression or splits it into fragments.
