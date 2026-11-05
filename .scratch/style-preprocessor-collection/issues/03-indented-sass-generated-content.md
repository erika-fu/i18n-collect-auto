# 03: Collect indented Sass generated content end to end

**What to build:** Let authors use directly written static Chinese strings in `content` declarations in standalone indented Sass resources and Vue `style` blocks with `lang="sass"`. The collected CSS generated content retains the same directives, source-location, source-range, and failure behaviour as standard CSS, while accurately handling Sass’s indentation-based syntax. Variables, interpolation, mixin output, function results, imports, and computed values remain outside automatic collection. The Vue 2 demo visibly builds and renders a Sass generated-content example that is present in its collected output.

**Blocked by:** 01: Establish source-style extraction foundation.

**Status:** ready-for-agent

- [ ] Standalone Sass and Vue Sass style blocks collect eligible directly authored static `content` strings with original source ranges and the `css-generated-content` semantic kind.
- [ ] Indented nested rules, static string forms, CSS escapes, CRLF, UTF-16 columns, declaration-level directives, and value-local directives preserve the established collection contract.
- [ ] Sass variables, interpolation, mixins, functions, imports, and computed values are not evaluated or collected.
- [ ] Invalid Sass is a collection failure at the original source location and leaves prior formal collection outputs unchanged.
- [ ] The Vue 2 demo compiles, renders, and collects a real Sass generated-content occurrence; focused extractor and webpack/Vue integration tests cover the behaviour.
