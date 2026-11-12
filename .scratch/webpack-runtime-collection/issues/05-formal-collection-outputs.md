# 05: Atomically publish and verify collection outputs

**What to build:** Publish `source-catalog.json` and `analysis-report.json` only after a successful complete collection round, with stable schemas and semantic comparison for verification.

**Blocked by:** 02: Support live resource snapshots and watch aggregation; 03: Unify JavaScript and TypeScript runtime collection; 04: Collect safe user-facing text from Vue render functions.

**Status:** done

- [x] Source catalog and analysis report have independent schema versions.
- [x] Keys, resource identities, source locations, diagnostics, and related collections have stable ordering.
- [x] Failed compilations cannot overwrite existing formal outputs.
- [x] Outputs include runtime findings, audit findings, diagnostics, and coverage as defined by the design.
- [x] Production verification compares normalized semantic content rather than raw JSON bytes.
- [x] Compiler and loader environment metadata does not cause failure when semantic results are unchanged.
- [x] Atomic publication and preservation of previous outputs are tested.
