# 06: Publish supported-style contract and run full regression

**What to build:** Publish the completed style-language contract: SCSS, indented Sass, Less, Stylus, and the `styl` alias are supported source-style languages for CSS generated content. Their syntax errors are collection failures rather than silent omissions. Documentation, demo collection outputs, and regression coverage consistently describe and verify this contract; unsupported-style warnings remain only for unknown or deliberately unsupported languages.

**Blocked by:** 02: Collect SCSS generated content end to end; 03: Collect indented Sass generated content end to end; 04: Collect Less generated content end to end; 05: Collect Stylus generated content end to end.

**Status:** ready-for-agent

- [ ] User-facing collection documentation, troubleshooting guidance, architecture records, and the style-language behaviour no longer describe SCSS, Sass, Less, or Stylus as warning-only unsupported languages.
- [ ] The supported-language contract explicitly states that syntax errors fail collection and preserve previous formal outputs; unknown or deliberately unsupported languages retain the warning-plus-empty-snapshot behaviour.
- [ ] Committed Vue 2 demo collection outputs include the real rendered examples for all four supported language families.
- [ ] The full root regression passes, including package tests, the Vue 2, Vue 3, and React demo builds, and formal-output verification.
