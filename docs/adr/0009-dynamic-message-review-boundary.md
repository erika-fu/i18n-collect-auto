# Dynamic message review boundary

## Status

Accepted and implemented. Collection reports whole-expression dynamic message candidates; decision-manifest consumption, `review` decision recording, proven-safe `review --write` source migrations, and `check` disposition policy are in place.

## Context

The project must retain location evidence for all discovered user-facing Chinese, including interpolation, concatenation, conditional construction, dynamic keys, plural or formatting logic, and rich-text structure. Treating static fragments inside those expressions as independent catalog messages makes translation unsafe; ignoring them entirely hides localization work from review.

## Decision

Complete static copy remains an automatic catalog message and may be replaced during the same collection pass. Valid explicit localization calls are validated against `explicit-messages.json` and represented in `source-catalog.json` with locations and occurrences. Dynamic or structured copy becomes a location-bearing **dynamic message candidate** in `analysis-report.json`: it is not split into catalog fragments, translated automatically, or automatically replaced.

Human review decides whether a candidate is translated through an explicit key and canonical source, intentionally ignored with a reason, or deferred. Those decisions belong in the version-controlled **dynamic message decision manifest** (`dynamic-message-decisions.json`) rather than in generated reports. The **Review** CLI records those decisions; for proven-safe concatenation and template-literal patterns, its explicit `--write` mode performs the approved source migration after showing a diff and receiving confirmation. It rejects source rewrites it cannot prove safe. `--write` is the only source-write flag; competing `--apply` semantics are not accepted.

Fragment-level `explicitRequiredFindings` are superseded by whole-expression candidates and are not part of the supported product surface.

## Consequences

- Every discovered user-facing Chinese occurrence remains locatable.
- `source-catalog.json` contains all confirmed runtime-localizable messages, whether automatic or explicit, but no unreviewed dynamic candidates.
- Source locations in catalog metadata are durable lifecycle and diagnostic evidence, not deferred replacement instructions.
- `check` enforces project policy for dynamic candidates still `needs-review`, still `translation-approved`, or deferred under project policy, without making the collector invent translation grammar or source rewrites.

## Considered options

- **Ignore dynamic copy until developers manually add an explicit call:** rejected because it conceals localization debt and removes the location needed to review it.
- **Collect static fragments around expressions as translation messages:** rejected because translation grammar, ordering, pluralization, and structure cannot be inferred from fragments.
- **Automatically rewrite every dynamic expression after collection:** rejected because framework call shapes and message semantics require human approval and are not universally safe to transform.
