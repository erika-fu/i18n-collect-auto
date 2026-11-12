# 08 — Make build replacement read-only

**What to build:** Make production builds consume a current source catalog without mutating collection outputs. JavaScript and TypeScript messages must become runtime `t` calls in memory, while Vue messages must become `$t` calls before template compilation so locale changes invalidate Vue's render output correctly.

**Blocked by:** 06 — Migrate automatic messages to exact-text hash keys.

**Status:** done

- [x] Build does not create, update, restore, or delete source catalog, audit, target catalog, or translation-state files.
- [x] Build fails before emitting formal output when source analysis no longer matches the committed source catalog.
- [x] JavaScript and TypeScript complete static messages are replaced in memory with runtime localization calls using current catalog keys.
- [x] Vue template text and user-facing attributes are replaced before the Vue template compiler generates render functions.
- [x] Vue 2 static render functions and Vue 3 cached nodes update correctly after a runtime locale change.
- [x] Existing localization calls remain unchanged and are not nested or duplicated.
- [x] Unsupported or stale runtime-localizable findings fail closed with source diagnostics.
- [x] HTML and style audit findings are not passed to the runtime replacement planner.
- [x] Watch mode remains serialized and does not start an implicit scan or catalog write.
- [x] Vue 2, Vue 3, and plain JavaScript integration tests verify emitted behavior and confirm catalog files remain byte-identical.

