# 03: Enforce explicit localization for structured and shared messages

**What to build:** Structured user-facing messages containing links, emphasis, controls, or component slots, and messages that intentionally share one translation across locations, are expressed through explicit localization rather than independently translated automatic fragments. Ordinary identical static Chinese occurrences remain independent automatic identities unless the author deliberately shares an explicit key.

**Blocked by:** 01: Add an explicit message manifest and dynamic-call catalog lifecycle; 02: Enforce complete static copy with an incremental baseline.

**Status:** implemented (uncommitted)

- [x] Define the supported explicit representation and message contracts for structured messages and intentionally shared translations, including ordering and placeholder semantics.
- [x] Detect unsupported automatic fragmentation of one structured message and provide an actionable policy failure that points developers to explicit localization.
- [x] Preserve the current occurrence-identity rule: equal complete static source text in separate locations receives independent automatic keys by default.
- [x] Add extractor, catalog, and end-to-end regressions covering links/emphasis/controls or slots, intentional shared keys, incompatible contracts, and unaffected independent duplicate literals.
- [x] Add a demo scenario that renders a structured explicitly localized message correctly, refresh its formal collection outputs, and cover it in runtime or integration verification.
- [x] Update the collection documentation and lessons to explain why grammatical ordering and accessible structure make fragment-by-fragment translation unsafe.
