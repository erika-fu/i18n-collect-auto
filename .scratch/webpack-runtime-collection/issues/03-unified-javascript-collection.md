# 03: Unify JavaScript and TypeScript runtime collection

**What to build:** Collect JavaScript, TypeScript, and Vue script/script-setup runtime messages through one AST pipeline while preserving the existing key, placeholder, and directive contracts.

**Blocked by:** 01: Establish Webpack module graph collection.

**Status:** ready-for-agent

- [ ] JavaScript and TypeScript use the same semantic finding pipeline.
- [ ] Complete static copy, template literals, explicit keys, and existing runtime localization calls follow the established contracts.
- [ ] Equal exact source text receives the same automatic key.
- [ ] Key conflicts and placeholder contract conflicts fail closed.
- [ ] Existing runtime collection directives retain their documented behavior.
- [ ] Findings include key, source text, semantic role, resource identity, source location, and replacement capability.
- [ ] Application source files remain unchanged.
- [ ] Tests cover scripts, TypeScript, script setup, and conflict cases.
