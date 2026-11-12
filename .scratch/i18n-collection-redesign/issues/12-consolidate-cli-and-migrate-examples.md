# 12 — Consolidate the CLI and migrate examples

**What to build:** Present the redesign as one coherent product with five commands and working examples. Users must be able to scan, translate, build, optionally replace source, and check completeness in Vue 2, Vue 3, and JavaScript-based applications without learning superseded workflows.

**Blocked by:** 11 — Contract legacy identity and style models.

**Status:** done

- [x] The public CLI exposes scan, translate, build, replace, and check as the primary workflow.
- [x] Superseded collect, run, verify, and separate policy-check workflows are removed or provide a bounded migration error consistent with the compatibility policy.
- [x] Command help accurately states which files each command can write.
- [x] Vue 2 and Vue 3 examples demonstrate scan, translation, read-only build replacement, locale switching, audit findings, and optional source replacement.
- [x] The JavaScript or React example demonstrates runtime messages and explicit-required behavior without claiming unsupported JSX replacement.
- [x] Examples contain representative standalone HTML and style audit findings with documented dispositions.
- [x] CI runs scan freshness, translation completeness, supported builds, and read-only check without hidden catalog mutation.
- [x] User documentation explains the normal workflow and separates runtime catalog messages from audit-only findings.
- [x] Migration documentation covers old per-occurrence catalogs, conflicting historical translations, removed state files, and changed command names.
- [x] Full workspace regression verifies package tests, all demos, source replacement, translation, audit, and locale switching.

