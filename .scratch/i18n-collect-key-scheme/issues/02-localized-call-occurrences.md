# 02: Collect Localized-Call Occurrences and Validate References

**What to build:** A normal collection recognizes static `t('key')`, `$t('key')`, and `this.$t('key')` calls, records them as active localized-call occurrences, and validates their referenced keys.

**Blocked by:** #01: Introduce Metadata v3 and Opaque Automatic Keys

**Status:** ready-for-agent

- [ ] Static string calls in supported adapter shapes are recorded as `localized-call` occurrences.
- [ ] Current source locations and structural anchors are updated from recognized calls.
- [ ] A non-retired orphaned key referenced by a literal call becomes active again.
- [ ] Unknown and retired project keys fail collection by default.
- [ ] Dynamic keys and unsupported call shapes are not misclassified and do not block ordinary collection.
- [ ] An `externalKeys` allowlist can permit externally managed unknown keys without creating project catalog entries.
- [ ] Tests cover supported calls, dynamic calls, unknown keys, retired keys, orphan recovery, and external keys.
