# 11 — Contract legacy identity and style models

**What to build:** Remove legacy mechanisms only after every production workflow has migrated to unified analysis and text-hash keys. The resulting product must no longer expose occurrence identity, ambiguity resolution, orphan retirement, or full preprocessor Style IR as concepts users must understand.

**Blocked by:** 07 — Simplify the translation lifecycle; 08 — Make build replacement read-only; 09 — Migrate source replacement to unified analysis; 10 — Unify project localization completeness checks.

**Status:** done

- [x] Runtime code no longer allocates or recovers per-occurrence automatic identities.
- [x] Ambiguity reports, identity confirmations, retirement confirmations, orphan statuses, and occurrence IDs are no longer read or written.
- [x] Catalog schemas and validation reject accidental reintroduction of legacy identity state while providing a clear migration diagnostic for unmigrated projects.
- [x] Full semantic adapters and intermediate representation used only for SCSS, Sass, Less, and Stylus collection are removed from production paths.
- [x] HTML and style findings cannot leak into runtime source catalogs.
- [x] Replacement metadata is no longer part of source or build replacement behavior.
- [x] Superseded configuration fields and command options fail with concise migration guidance rather than being silently ignored.
- [x] Legacy implementation-focused tests are removed only after equivalent external behavior is covered through the new interfaces.
- [x] Package tests and all supported integration builds remain green after contraction.
