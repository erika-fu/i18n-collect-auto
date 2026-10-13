# 01 — Support the local exclusion directive

**What to build:** Make `no-i18n-auto` a supported, node-local exclusion directive in the collection workflow. A syntax-valid comment immediately preceding a collectable source construct suppresses only the next associated collected text/static fragment; the comment itself is control metadata and is never collected. Apply the contract consistently to the supported script, Vue-template/static-HTML, and CSS collection semantics without changing source-coordinate, resource-snapshot, or failed-round guarantees.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A preceding `no-i18n-auto` directive excludes exactly its next associated candidate and does not suppress unrelated adjacent candidates.
- [ ] Script, Vue-template/static-HTML, and CSS cases have deliberate, documented association rules and regression coverage.
- [ ] Existing collection output remains unchanged for sources without directives.
- [ ] The domain glossary and user documentation agree that the directive is implemented and that ordinary comments are not collected.
- [ ] Unit and Webpack integration tests cover valid directives, non-directive comments, malformed/irrelevant comments, and incremental collection behavior.
