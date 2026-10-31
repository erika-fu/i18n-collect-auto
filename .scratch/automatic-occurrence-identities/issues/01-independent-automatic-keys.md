# 01: Assign independent automatic keys to occurrences

**What to build:** Collecting identical text at separate source locations creates an independent automatic localization key for every occurrence, so those locations can receive different translations while legacy MD5 output remains text-deduplicated for compatibility.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Identical source text in distinct JavaScript/TypeScript, Vue template, HTML, and CSS occurrences produces distinct catalog keys and independently addressable metadata records.
- [ ] The legacy MD5 dictionary and source map continue to deduplicate by text value without becoming the localization-key identity.
- [ ] Collection tests cover the new occurrence behavior and prevent regressions in existing output.
