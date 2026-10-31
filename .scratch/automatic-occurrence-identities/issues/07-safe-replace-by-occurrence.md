# 07: Replace source safely using occurrence metadata

**What to build:** Source replacement previews and writes localization calls using the current occurrence metadata and localization key, so identical original text at separate locations is rewritten to the correct independent key. Unsafe, ambiguous, stale, or unsupported positions are explicitly reported.

**Blocked by:** 05: Report and resolve ambiguous occurrence identity; 06: Track translation review and occurrence retirement.

**Status:** ready-for-agent

- [x] Replace distinguishes same-text occurrences and emits the correct independent or intentionally shared key per location.
- [x] Preview, write, and strict modes retain their atomicity guarantees and do not partially rewrite unsafe sources.
- [x] Tests cover separate and shared keys, stale/ambiguous metadata, unsupported locations, strict mode, and continued preservation of legacy MD5 calls.
