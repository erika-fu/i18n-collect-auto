# 06 — Migrate automatic messages to exact-text hash keys

**What to build:** Replace per-occurrence automatic identities with deterministic automatic keys derived from exact source text, and provide a safe migration for existing catalogs and translations. Identical exact source text shares one automatic key; contextual differences require explicit keys.

**Blocked by:** 05 — Classify and validate explicit messages.

**Status:** done

- [x] Automatic keys are deterministic hashes of exact source text without whitespace, punctuation, case, or Unicode normalization.
- [x] Equal exact source text across JavaScript, TypeScript, and Vue shares one automatic key.
- [x] Hash generation is stable across machines, source paths, line movement, and collection order.
- [x] Hash collisions between unequal source texts fail with both messages identified; collisions never silently merge.
- [x] Explicit keys remain unchanged and continue to enforce message and placeholder contracts.
- [x] Migration reuses a target translation automatically when all old keys for the same source text have equivalent translations.
- [x] Migration stops with a report when old keys for one source text contain different translations, requiring explicit keys to preserve contextual meaning.
- [x] Migration never chooses one conflicting historical translation heuristically.
- [x] A successful migration produces deterministic current source and target catalogs without occurrence identities.
- [x] Migration can be retried safely after conflicts are resolved.
- [x] End-to-end fixtures cover one-to-one migration, many-to-one merge, contextual conflict, explicit-key preservation, and collision diagnostics.
