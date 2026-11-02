# 01: Add an explicit message manifest and dynamic-call catalog lifecycle

**What to build:** Developers can version an explicit source-message manifest that declares a localization key, canonical Chinese message, and placeholder contract, then reference that key from a static runtime localization call such as `t('items.deleted', { count })`. Collection validates the call and its parameters, carries the declared message through the source catalog and metadata, and preserves its translation-review lifecycle without requiring ordinary static Chinese source text to be rewritten.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Define and validate a versioned, project-owned explicit message manifest that supplies the canonical source message and placeholder contract for explicitly localized messages.
- [ ] Make collection recognize supported static localized calls with parameters, validate their key and parameter contract against the manifest, and publish their catalog and metadata identity transactionally.
- [ ] Preserve the existing lifecycle: a source-message edit retains its key, changes the fingerprint, and marks target-locale text as needing review; unknown, retired, and mismatched calls fail without publishing partial formal outputs.
- [ ] Add focused unit, collection-integration, and lifecycle regressions for valid declarations, manifest validation failures, unknown keys, placeholder mismatches, source edits, orphan recovery, and existing localized-call compatibility.
- [ ] Add a minimal Vue or React demo scenario that proves a declared dynamic message resolves at runtime and refresh its committed collection outputs.
- [ ] Update user-facing documentation and the relevant lessons to distinguish explicit source messages from automatically collected complete static copy.
