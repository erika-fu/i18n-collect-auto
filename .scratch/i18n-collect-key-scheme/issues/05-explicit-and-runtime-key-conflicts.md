# 05: Enforce Explicit and Runtime Identity Conflict Rules

**What to build:** Explicit `i18n-key` directives, runtime key references, and identity confirmations resolve occurrence identity consistently and reject conflicting declarations.

**Blocked by:** #02: Collect Localized-Call Occurrences and Validate References; #04: Recover Historical Occurrence Identities Conservatively

**Status:** ready-for-agent

- [ ] A localized call and a colocated `i18n-key` with different keys fail collection.
- [ ] Matching localized-call and directive keys are accepted.
- [ ] Changing an automatic occurrence to an explicit key makes the explicit key the new identity.
- [ ] The former automatic key remains orphaned and its translation asset is not implicitly migrated.
- [ ] A confirmation manifest can select only a reported historical candidate or proposed key.
- [ ] The same key cannot be confirmed for incompatible occurrences in one round.
- [ ] Tests cover declaration conflicts, explicit-key changes, manifest validation, and message-contract conflicts.
