# 03: Unify JavaScript and TypeScript runtime collection

**What to build:** Collect JavaScript, TypeScript, and Vue script/script-setup runtime messages through one AST pipeline while preserving the existing key, placeholder, and directive contracts.

**Blocked by:** 01: Establish Webpack module graph collection.

**Status:** ready-for-agent

- [x] JavaScript and TypeScript use the same semantic finding pipeline.
- [x] Complete static copy, template literals, explicit keys, and existing runtime localization calls follow the established contracts.
- [x] Equal exact source text receives the same automatic key.
- [x] Key conflicts and placeholder contract conflicts fail closed.
- [x] Existing runtime collection directives retain their documented behavior.
- [x] Findings include key, source text, semantic role, resource identity, source location, and replacement capability.
- [x] Application source files remain unchanged.
- [x] Tests cover scripts, TypeScript, script setup, and conflict cases.
