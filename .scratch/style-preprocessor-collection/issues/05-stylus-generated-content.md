# 05: Collect Stylus generated content end to end

**What to build:** Let authors use directly written static Chinese strings in `content` declarations in standalone `.styl` and `.stylus` resources and Vue `style` blocks using `lang="styl"` or `lang="stylus"`. The strings become CSS generated content with the established source-location, directive, snapshot, and collection-failure guarantees, including for Stylus’s indentation-based syntax. `styl` and `stylus` share parsing semantics while preserving each resource’s actual identity and original location. Variables, interpolation, mixin output, function results, imports, and computed values remain outside automatic collection. The Vue 2 demo visibly builds and renders a Stylus generated-content example that is present in its collected output.

**Blocked by:** 01: Establish source-style extraction foundation.

**Status:** ready-for-agent

- [ ] Standalone `.styl`/`.stylus` resources and Vue `styl`/`stylus` blocks collect eligible directly authored static `content` strings with original ranges and the `css-generated-content` semantic kind.
- [ ] Indented rules without CSS braces or semicolons, single- and double-quoted strings, CSS escapes, CRLF, UTF-16 columns, declaration-level directives, and value-local directives preserve the established collection contract.
- [ ] Stylus variables, interpolation, mixins, functions, imports, and computed values are not evaluated or collected.
- [ ] Invalid Stylus is a collection failure at the original source location and preserves prior formal collection outputs.
- [ ] The Vue 2 demo compiles, renders, and collects a real Stylus generated-content occurrence; focused extractor and webpack/Vue integration tests cover both `styl` and `stylus` aliases.
