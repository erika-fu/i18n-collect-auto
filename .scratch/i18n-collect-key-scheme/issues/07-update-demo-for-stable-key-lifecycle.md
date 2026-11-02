# 07: Update the Demo for the Stable Key Lifecycle

**What to build:** The demo visibly exercises independent identities for equal source text, localized-call references, explicit keys, and review behavior after source changes.

**Blocked by:** #02: Collect Localized-Call Occurrences and Validate References; #03: Preserve Catalog Lifecycle Across Source and Localized Occurrences; #05: Enforce Explicit and Runtime Identity Conflict Rules

**Status:** done

- [x] The demo contains at least two occurrences with equal source text and independent automatic keys.
- [x] The demo includes an occurrence already represented by a runtime localization call.
- [x] The demo demonstrates source-text and localized-call occurrences coexisting for one key where appropriate.
- [x] The demo includes an explicit key with a stable identity.
- [x] The demo remains consistent without rerunning source replacement after ordinary source movement or editing.
- [x] The running demo resolves and displays the expected translations.
- [x] Demo fixtures and generated data do not overwrite committed test outputs unexpectedly.
