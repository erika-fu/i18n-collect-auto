# 06 — Protect external translation and catalog writes

**What to build:** Make translation externally safe and persistence-safe. Before a provider can transmit source text outside the project, interactive use requests confirmation and non-interactive/CI use requires explicit `--allow-network` authorization. Persist catalog entries, review state, and related translation artifacts through a prepare-and-commit transaction with rollback on write failure, so an interrupted operation cannot leave a partial catalog state. Provide clear diagnostics for denied authorization, provider errors, partial item failures, and storage failures.

**Blocked by:** 05 — Translate catalogs through a project provider.

**Status:** implemented

- [x] A network-capable translation operation cannot transmit source text without interactive confirmation or explicit non-interactive authorization.
- [x] Local/offline fake provider tests can exercise translation without requiring real credentials or outbound network traffic.
- [x] All planned file contents are prepared before replacement, and a failed replacement restores every already changed translation artifact.
- [x] Partial item failures follow the configured policy and are distinguishable from authorization and persistence failures.
- [x] Integration tests prove authorization refusal, explicit authorization, provider failure, and rollback behavior.
