# 05 — Classify and validate explicit messages

**What to build:** Give dynamic, interpolated, formatted, pluralized, and structurally fragmented copy one explicit path. Scan must reject unsafe fragment-level automation and validate the project-owned explicit message declarations used by runtime localization calls.

**Blocked by:** 02 — Introduce unified project analysis.

**Status:** done

- [x] Dynamic construction, interpolation, formatting, pluralization, and structured markup fragmentation are classified as `explicit-required`.
- [x] Explicit-required findings do not receive automatic keys and do not enter the source catalog as independent fragments.
- [x] The explicit message manifest remains the authority for an explicit key's canonical source text and placeholder contract.
- [x] Static runtime localization calls to project-owned keys must resolve to an explicit declaration or an automatically collected static message.
- [x] Unknown project keys, unused declarations, conflicting source text, and incompatible placeholder contracts produce actionable failures.
- [x] External keys can still be declared without creating project-owned source catalog entries.
- [x] A static complete message can select an explicit key through a valid adjacent key directive.
- [x] A key directive that conflicts with an existing localized call fails.
- [x] Tests cover structured Vue content, dynamic script messages, placeholder ordering, explicit sharing, unknown keys, and external keys.

