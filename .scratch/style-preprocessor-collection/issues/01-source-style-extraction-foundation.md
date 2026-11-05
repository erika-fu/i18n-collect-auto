# 01: Establish source-style extraction foundation

**What to build:** Make the style collection boundary ready for supported source-style languages while preserving the current standard CSS collection result. Collection must read and interpret author-written style source, rather than webpack loader output, so a CSS generated content occurrence always retains its original source location. A supported language collects only directly written, static strings in a `content` declaration; it does not evaluate variables, interpolation, mixins, functions, imports, or other computed values. Record this decision as an ADR because it defines the durable semantic collection stage and source-coordinate contract.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The existing standard CSS behaviour remains unchanged: every eligible static string in `content` is collected as `css-generated-content`, existing block-comment directives retain their current association rules, and source ranges remain original half-open UTF-16 ranges.
- [ ] A language-neutral style extraction boundary can accept parser-specific source declarations and comments without duplicating collection-result, directive, string-decoding, or location semantics per language.
- [ ] The language boundary distinguishes a directly authored static string token from computed style values without invoking webpack loaders or preprocessors.
- [ ] Existing CSS extraction and webpack/Vue style integration regressions pass.
- [ ] An ADR documents why extraction is based on original style source and parser ASTs rather than compiled CSS, and why computed values are outside automatic collection.
