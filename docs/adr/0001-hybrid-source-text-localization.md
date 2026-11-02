# Hybrid source-text localization

The project accepts a hybrid localization model: complete, static Chinese UI copy may remain as source text and receives an automatic localization key through semantic collection and catalog metadata; messages that need runtime multilingual rendering or carry variables, plural rules, formatting, rich-text structure, semantic ambiguity, or intentional cross-location sharing must use an explicit localization call and key. This preserves low-friction Chinese-first authoring without treating the final bundle or the raw text value as the translation identity.

## Consequences

- An automatic key remains an opaque, per-occurrence `auto.<ULID>` recovered from occurrence identity; identical source text at separate locations does not automatically share a translation.
- A complete static literal is eligible for automatic collection. Template interpolation, concatenation, conditional construction, and formatting are not complete static literals and must be represented by an explicit localized message rather than independently translated fragments.
- Structured UI copy that includes links, emphasis, controls, or component slots must use the explicit localization API so translation can control ordering and placeholders.
- Editing canonical source text preserves its localization key, changes its source fingerprint, and marks target translations for review. Identity ambiguity remains fail-closed and requires an explicit key or confirmation manifest.
- The catalog and metadata produced by a successful semantic collection are the authority for automatic-copy tracking. CI validates both that collection produces no uncommitted formal-output changes and that no new rule violation is introduced. A baseline permits existing violations to be migrated incrementally, except that collection failures, identity ambiguities, stale formal outputs, and direct source text in a declared multilingual feature remain blocking.
- A feature or route that is declared runtime-multilingual is an explicit-localization boundary: its user-visible copy must use explicit localization calls. Teams may migrate durable or critical copy before that boundary.

## Considered options

- **Require explicit keys for all source copy:** rejected because it imposes key-management work on short-lived, static, Chinese-first UI copy without adding comparable semantic value.
- **Translate raw source text automatically at build or runtime:** rejected because equal text can be contextually distinct and raw text cannot safely express placeholders, pluralization, or structured-message ordering.
- **Allow automatic collection of dynamic fragments:** rejected because independently translating fragments around an expression corrupts grammar and message semantics.
