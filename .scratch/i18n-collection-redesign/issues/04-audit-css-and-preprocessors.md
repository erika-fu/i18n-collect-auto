# 04 — Audit CSS and style preprocessors end to end

**What to build:** Report Chinese generated content in standard CSS accurately and surface possible Chinese user-facing content in supported style preprocessors without retaining the existing full semantic parsing and replacement machinery.

**Blocked by:** 02 — Introduce unified project analysis.

**Status:** done

- [x] Standard CSS is parsed structurally and reports Chinese static strings in `content` declarations with original source locations.
- [x] CSS comments, selectors, property names, custom-property definitions, and unrelated declaration values do not become audit findings.
- [x] SCSS, indented Sass, Less, and Stylus receive lightweight source scanning that cannot execute imports, variables, functions, mixins, or interpolation.
- [x] Potential preprocessor findings are classified as `needs-review` rather than claimed as semantically proven generated content.
- [x] Style audit findings never receive localization keys and never enter source or target catalogs.
- [x] Adjacent reasoned ignore directives can dispose of exact CSS and preprocessor findings under the same contract as HTML.
- [x] Every unresolved CSS finding or preprocessor `needs-review` finding prevents project localization completeness.
- [x] Diagnostics explain whether a finding is proven CSS generated content or a conservative preprocessor review item.
- [x] Tests include comments, escaped strings, dynamic values, interpolation, malformed input, and reasoned ignores.

