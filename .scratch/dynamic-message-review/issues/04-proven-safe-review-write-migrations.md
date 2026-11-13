# 04: Implement proven-safe review write migrations

**What to build:** Following an approved Translate decision, `i18n-collect review --write` previews a source diff and, only after explicit confirmation, migrates demonstrably safe dynamic JS/TS and Vue expression messages to their approved explicit localization calls. Developers receive a clear refusal instead of a guessed rewrite for expressions outside the proven-safe boundary.

**Blocked by:** 03: Add review CLI and atomic explicit-message decisions.

**Status:** implemented

- [x] Safe string concatenation and template-literal cases with side-effect-free interpolations and mechanically derivable named placeholders can be previewed and written correctly.
- [x] Writes require an explicit confirmation path and preserve source on preview, refusal, validation failure, or cancellation.
- [x] Conditional construction, dynamic keys, plural/formatting logic, rich text, and other structured messages are rejected for automatic source writing while remaining reviewable.
- [x] The CLI has one canonical write flag, `--write`; no competing `--apply` behavior remains.
- [x] Regression tests cover successful JS/TS and Vue migrations, diffs, confirmation, and every rejected class.
