# 09 — Migrate source replacement to unified analysis

**What to build:** Preserve optional permanent migration of supported source copy while removing long-lived replacement bookkeeping. Replacement must consume the same current analysis and key decisions as build replacement, preview by default, and modify only supported JavaScript, TypeScript, and Vue source when explicitly requested.

**Blocked by:** 06 — Migrate automatic messages to exact-text hash keys.

**Status:** done

- [x] Replacement previews deterministic per-file edits without writing source, catalogs, audit reports, or metadata.
- [x] A write operation modifies only JavaScript, TypeScript, and Vue source locations classified as automatically runtime-localizable.
- [x] Vue edits target original template text and attributes, never generated render functions.
- [x] Dynamic, structured, audit-only, needs-review, stale, mismatched, and overlapping findings are not automatically rewritten.
- [x] Existing runtime localization calls remain unchanged, making repeated replacement idempotent.
- [x] Source text and ranges are revalidated immediately before writing.
- [x] All changed source files are prepared and committed as one transaction; a failure restores the original source set.
- [x] Replacement does not write catalogs or maintain a replacement audit database; version control is the rollback mechanism.
- [x] Explicit key directives select their declared key in generated calls.
- [x] Tests cover preview, write, retry, stale source, rollback, Vue attributes, script expressions, and unsupported findings.
