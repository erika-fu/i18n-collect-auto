# 10: Update Design and Migration Documentation

**What to build:** Project documentation describes the final identity model, migration behavior, operational validation, and known limitations in terms that match the implementation.

**Blocked by:** #08: Verify the End-to-End Migration Workflow; #09: Run Tests, Builds, and Demo Verification

**Status:** ready-for-agent

- [ ] Documentation distinguishes localization key, occurrence identity, structural anchor, and source location.
- [ ] The lifecycle of `auto.<ULID>` is documented.
- [ ] Localized-call, orphaned, retired, and external-key behavior is documented.
- [ ] Ambiguity confirmation and failed-round protection are documented.
- [ ] `replacements.json` is documented as audit, rollback, and diagnostic data rather than the authority for normal identity recovery.
- [ ] Version 2 to version 3 metadata migration is documented.
- [ ] Commands and behavior described in the documentation match the verified implementation and test results.
