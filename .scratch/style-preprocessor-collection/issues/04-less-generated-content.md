# 04: Collect Less generated content end to end

**What to build:** Let authors use directly written static Chinese strings in `content` declarations in standalone Less resources and Vue `style` blocks with `lang="less"`. The strings become CSS generated content with the established source-location, directive, snapshot, and collection-failure guarantees. Less variables, interpolation, mixin output, function results, imports, and computed values remain outside automatic collection. The Vue 2 demo visibly builds and renders a Less generated-content example that is present in its collected output.

**Blocked by:** 01: Establish source-style extraction foundation.

**Status:** ready-for-agent

- [ ] Standalone Less and Vue Less style blocks collect each eligible directly authored static `content` string with original source ranges and the `css-generated-content` semantic kind.
- [ ] Nested Less rules, multiple strings, CSS escapes, CRLF, UTF-16 columns, declaration-level directives, and value-local directives preserve the established CSS collection contract.
- [ ] Less variables, interpolation, mixins, functions, imports, and computed values are not evaluated or collected.
- [ ] Invalid Less is a collection failure at the original source location and preserves prior formal collection outputs.
- [ ] The Vue 2 demo compiles, renders, and collects a real Less generated-content occurrence; focused extractor and webpack/Vue integration tests cover the behaviour.
