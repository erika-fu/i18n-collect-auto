# 04 — Establish the keyed translation catalog

**What to build:** Establish a keyed translation-catalog model derived from the collection result, which becomes the stable shared boundary for translation and source replacement. A developer may attach an explicit localization key with a preceding `i18n-key` directive; otherwise the tool derives a deterministic key from resource path, semantic location, and source text. Detect and diagnose key conflicts. Retain the current hash dictionary/source map during the migration period while exporting a default flat JSON catalog per locale through a format-adapter boundary. Preserve source-text fingerprints so later stages can mark translations for review when source text changes.

**Blocked by:** 03 — Provide the collection CLI workflow.

**Status:** ready-for-agent

- [ ] Every eligible collected text can obtain either a validated explicit localization key or a deterministic derived key.
- [ ] Key collisions, malformed key directives, and incompatible duplicate declarations fail or report with actionable source locations.
- [ ] The default catalog representation is a flat locale JSON mapping, while export format is isolated behind an adapter contract.
- [ ] Current hash collection outputs and source maps continue to be produced unchanged during the transition.
- [ ] Catalog metadata records enough source identity/fingerprint information to distinguish unchanged, added, removed, and source-changed keys.
- [ ] Unit and CLI integration tests cover explicit keys, derived keys, collisions, stable output, and compatibility outputs.
