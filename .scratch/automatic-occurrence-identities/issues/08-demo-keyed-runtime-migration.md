# 08: Demonstrate keyed-catalog runtime migration

**What to build:** The demo proves the complete migration path: new replacement calls resolve localization keys from keyed catalogs, old MD5-based calls continue through a compatibility fallback, and same source text in distinct occurrences can visibly use different translations.

**Blocked by:** 06: Track translation review and occurrence retirement; 07: Replace source safely using occurrence metadata.

**Status:** ready-for-agent

- [ ] The demo prioritizes keyed-catalog lookup while preserving the legacy MD5 fallback for unreplaced calls.
- [ ] Demo fixtures include equal source text with separate keys and visibly different target translations.
- [ ] End-to-end tests exercise collect, translate, replace, and demo runtime behavior; demo documentation states the compatibility-layer removal criteria.
