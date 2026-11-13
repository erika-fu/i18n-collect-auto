# Deterministic keys from exact source text

## Status

Accepted. Supersedes the per-occurrence automatic-key identity decision in ADR-0001. The hybrid authoring rules remain accepted: complete static copy may stay as source text, while dynamic, structured, and runtime-multilingual copy needs an explicit localization call before translation. ADR-0009 records dynamic and structured copy as location-bearing **dynamic message candidates** for human review.

## Decision

Automatic localization keys are deterministic hashes of the exact source text. Equal exact source text shares one automatic key across JavaScript, TypeScript, and Vue. Contextual translation differences require an explicit key. A hash collision between unequal source texts fails closed with both messages identified.

Per-occurrence opaque `auto.<ULID>` keys, structural-anchor recovery, ambiguity reports, and identity confirmations are retired by this decision.

## Considered options

- **Keep per-occurrence automatic keys:** rejected because identical copy could not share translations without manual key work, and occurrence-identity recovery created ambiguity, confirmation, and orphan machinery disproportionate to the benefit.
- **Normalize text before hashing:** rejected because invisible normalization would merge messages authors still treat as distinct spellings.
- **Derive keys from path plus text:** rejected because moves and renames would churn keys without changing meaning.
