# Dynamic message review boundary

## Status

Accepted. Decision-manifest consumption, `review` decision recording, and proven-safe `review --write` source migrations are implemented.

## Context

The project must retain location evidence for all discovered user-facing Chinese, including interpolation, concatenation, conditional construction, dynamic keys, plural or formatting logic, and rich-text structure. Treating static fragments inside those expressions as independent catalog messages makes translation unsafe; ignoring them entirely hides localization work from review.

## Decision

Complete static copy remains an automatic catalog message and may be replaced during the same collection pass. Valid explicit localization calls are validated against `explicit-messages.json` and represented in `source-catalog.json` with locations and occurrences. Dynamic or structured copy will become a location-bearing dynamic message candidate in `analysis-report.json`: it will not be split into catalog fragments, translated automatically, or automatically replaced. This candidate reporting is a design decision pending implementation.

Human review decides whether a candidate is translated through an explicit key and canonical source, intentionally ignored with a reason, or deferred. Those decisions belong in a version-controlled input manifest rather than in generated reports. The planned CLI records and reviews those decisions; for proven-safe patterns, its explicit write mode performs the approved source migration after showing a diff and receiving confirmation. It rejects source rewrites it cannot prove safe.

## Consequences

- Every discovered user-facing Chinese occurrence remains locatable.
- `source-catalog.json` contains all confirmed runtime-localizable messages, whether automatic or explicit, but no unreviewed dynamic candidates.
- Source locations in catalog metadata are durable lifecycle and diagnostic evidence, not deferred replacement instructions.
- `check` can enforce project policy for unresolved dynamic candidates without making the collector invent translation grammar or source rewrites.

## Considered options

- **Ignore dynamic copy until developers manually add an explicit call:** rejected because it conceals localization debt and removes the location needed to review it.
- **Collect static fragments around expressions as translation messages:** rejected because translation grammar, ordering, pluralization, and structure cannot be inferred from fragments.
- **Automatically rewrite every dynamic expression after collection:** rejected because framework call shapes and message semantics require human approval and are not universally safe to transform.
