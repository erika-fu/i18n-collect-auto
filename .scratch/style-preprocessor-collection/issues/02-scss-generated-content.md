# 02: Collect SCSS generated content end to end

**What to build:** Let authors use directly written static Chinese strings in `content` declarations in standalone SCSS resources and Vue `style` blocks with `lang="scss"`. Those strings become CSS generated content with the same collection result, source-location, key-directive, exclusion-directive, and collection-failure guarantees as standard CSS. Variables, interpolation, mixin output, function results, imports, and other computed SCSS values remain outside automatic collection. The Vue 2 demo visibly builds and renders a SCSS generated-content example that is present in its collected output.

**Blocked by:** 01: Establish source-style extraction foundation.

**Status:** ready-for-agent

- [ ] Standalone SCSS and Vue SCSS style blocks collect each directly authored eligible static `content` string with an original source range and the `css-generated-content` semantic kind.
- [ ] Nested SCSS rules, multiple strings in one value, CSS escapes, CRLF, astral-character UTF-16 columns, declaration-level directives, and value-local directives preserve the existing CSS contract.
- [ ] SCSS variables, interpolation, mixins, functions, imports, and computed values are not evaluated or collected.
- [ ] Invalid SCSS is a collection failure that identifies the original source location and preserves the prior formal collection outputs.
- [ ] The Vue 2 demo compiles, renders, and collects a real SCSS generated-content occurrence; focused extractor and webpack/Vue integration tests cover the behaviour.
