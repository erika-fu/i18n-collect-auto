# 04: Collect safe user-facing text from Vue render functions

**What to build:** Process Vue compiler render-function JavaScript through the shared AST pipeline and collect only explicitly supported text-child and allowlisted property positions.

**Blocked by:** 01: Establish Webpack module graph collection; 03: Unify JavaScript and TypeScript runtime collection.

**Status:** ready-for-agent

- [x] The project-supported Vue versions have separate, explicit recognition policies.
- [x] Safe VNode text children are collected.
- [x] Allowlisted user-facing properties such as `title`, `placeholder`, `alt`, `aria-label`, and `value` are collected.
- [x] Structural, event, directive, slot, component, test, and other non-user-facing properties are ignored.
- [x] Spreads, dynamic props, dynamic children, conditional merges, and unknown helper shapes are never silently rewritten or collected as safe findings.
- [x] Unsupported SSR, optimization, and custom-transform shapes receive an explicit diagnostic or are conservatively skipped.
- [x] Vue 2 and Vue 3 coverage is verified by integration tests where supported.
