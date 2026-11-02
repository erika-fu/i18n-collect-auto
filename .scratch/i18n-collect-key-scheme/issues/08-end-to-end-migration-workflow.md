# 08: Verify the End-to-End Migration Workflow

**What to build:** The real user workflow remains consistent through collection, translation, source replacement, and a later ordinary collection after source edits or moves without rerunning replacement.

**Blocked by:** #06: Add Collection and Catalog Integration Coverage; #07: Update the Demo for the Stable Key Lifecycle

**Status:** ready-for-agent

- [ ] Initial collection, translation, and replacement with write enabled succeed.
- [ ] Formatting, moving, or restructuring source leaves runtime keys unchanged on the next ordinary collection.
- [ ] A committed runtime call is not incorrectly treated as an orphan merely because the original source text is absent.
- [ ] A source wording change preserves the key and marks the target translation `needs-review`.
- [ ] Deletion of an occurrence is distinguished from replacement by a localized call.
- [ ] Any failed stage leaves its formal outputs unchanged.
- [ ] The workflow uses temporary test data and does not modify committed demo outputs.
