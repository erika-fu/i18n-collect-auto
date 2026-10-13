# 08 — Commit replacements and compose workflows

**What to build:** Add explicit `replace --write` and the `run` orchestration subcommand. Source files, keyed catalogs, and replacement metadata must be prepared before any write and committed transactionally with rollback if any replacement fails. `run` composes selected collection, translation, and replacement stages into reproducible workflows including collect-only, collect-and-translate, collect-and-replace, and full flow. Default behavior remains dry-run for replacement, and strict-mode/network-authorization behavior remains identical whether stages run alone or through `run`.

**Blocked by:** 06 — Protect external translation and catalog writes; 07 — Preview safe source replacement.

**Status:** ready-for-agent

- [ ] Source is changed only when the caller explicitly requests `--write`; otherwise replacement remains preview-only.
- [ ] A write failure after one or more file replacements restores all affected source, catalog, and metadata files to their prior content.
- [ ] `run` composes selected stages predictably and exposes stable non-interactive inputs, outputs, exit codes, and diagnostics.
- [ ] Network permission and strict-mode semantics are preserved when translation/replacement run through the orchestration command.
- [ ] Integration tests cover successful writes, multi-file rollback, collect-only, translate-only composition, replacement composition, and the full workflow.
