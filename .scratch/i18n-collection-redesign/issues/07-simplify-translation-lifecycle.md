# 07 — Simplify the translation lifecycle

**What to build:** Make translation operate on the current text-hash source catalog and explicit messages without orphan and retirement state. Missing translations and changed explicit messages must remain safe, while stale target entries are removed only by an explicit prune operation.

**Blocked by:** 06 — Migrate automatic messages to exact-text hash keys.

**Status:** done

- [x] Translate requests drafts only for current source keys missing from requested target locales unless forced retranslation is requested.
- [x] Existing target text is preserved by default.
- [x] An explicit key whose canonical source text changes retains its target text but becomes `needs-review`.
- [x] Needs-review translations prevent locale completeness until retranslated or explicitly confirmed against the new source fingerprint.
- [x] A changed automatic source message produces a new text-hash key and therefore a normal missing translation.
- [x] Target keys absent from the current source catalog are reported as stale but do not fail locale completeness.
- [x] An explicit prune option removes stale target entries and their translation state.
- [x] Provider authorization, partial-versus-strict failure behavior, and transactional target-catalog writes remain supported.
- [x] Translation no longer reads or writes orphan, retirement, or occurrence-identity state.
- [x] Tests cover missing drafts, existing translations, explicit source changes, stale keys, prune, provider failures, and interrupted writes.
