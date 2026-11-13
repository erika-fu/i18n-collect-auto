# Hybrid source-text localization

## Status

Accepted for hybrid authoring. Superseded by ADR-0005 for automatic-key identity and by ADR-0009 for the accepted, pending dynamic-message review boundary. Requiring an explicit message before translation remains accepted; today dynamic copy produces fragment-based explicit-required findings, while ADR-0009 replaces that behavior with whole-expression candidates when implemented.

## Decision

The project accepts a hybrid localization model: complete, static Chinese UI copy may remain as source text and receives an automatic localization key through semantic analysis and the source catalog; messages that need runtime multilingual rendering or carry variables, plural rules, formatting, rich-text structure, or semantic ambiguity must use an explicit localization call and key. Contextual translation differences also require an explicit key (ADR-0005). This preserves low-friction Chinese-first authoring without treating the final bundle as the translation identity.

## Consequences

- Historical (superseded by ADR-0005): an automatic key remained an opaque, per-occurrence `auto.<ULID>` recovered from occurrence identity; identical source text at separate locations did not automatically share a translation; identity ambiguity was fail-closed via an explicit key or confirmation manifest.
- A complete static literal is eligible for automatic collection. Template interpolation, concatenation, conditional construction, formatting, and structured UI copy are not complete static literals and must be represented by an explicit localized message before translation. Today the policy reports static fragment findings; ADR-0009 accepts their future replacement with whole-expression, location-bearing candidates. Neither model permits independently translated fragments.
- Structured UI copy that includes links, emphasis, controls, or component slots must use the explicit localization API so translation can control ordering and placeholders.
- Editing an explicit key's canonical source text preserves that key, changes its source fingerprint, and marks target translations for review. Changing automatic source text yields a new exact-text key per ADR-0005.
- The source catalog produced by a successful scan is the authority for runtime-localizable automatic copy. CI validates that formal outputs stay committed and that no new rule violation is introduced. A baseline may grandfather existing complete-static-copy violations, except that analysis failures, stale formal outputs, and direct source text in a declared multilingual feature remain blocking.
- A feature or route that is declared runtime-multilingual is an explicit-localization boundary: its user-visible copy must use explicit localization calls. Teams may migrate durable or critical copy before that boundary.

## Considered options

- **Require explicit keys for all source copy:** rejected because it imposes key-management work on short-lived, static, Chinese-first UI copy without adding comparable semantic value.
- **Translate raw source text automatically at build or runtime:** rejected because equal text can be contextually distinct and raw text cannot safely express placeholders, pluralization, or structured-message ordering.
- **Allow automatic collection of dynamic fragments:** rejected because independently translating fragments around an expression corrupts grammar and message semantics. Current explicit-required findings make the migration requirement visible; ADR-0009 instead requires a future whole-expression human-review candidate with location evidence.
