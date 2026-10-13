# 09 — Document migration and verify the complete workflow

**What to build:** Finish the user-facing migration experience and prove the complete collection-to-localization workflow. Publish coherent English and Chinese documentation, glossary updates, and migration guidance that distinguish collected text, hash collection outputs, keyed translation catalogs, translation providers, and source replacement. Provide representative Vue 2, Vue 3, and generic JavaScript fixtures/examples. Verify every released contract using stable local tests; a real third-party translation service is not a repository test dependency.

**Blocked by:** 01 — Support the local exclusion directive; 02 — Add glob scope and optional context filters; 03 — Provide the collection CLI workflow; 04 — Establish the keyed translation catalog; 05 — Translate catalogs through a project provider; 06 — Protect external translation and catalog writes; 07 — Preview safe source replacement; 08 — Commit replacements and compose workflows.

**Status:** ready-for-agent

- [ ] Documentation clearly explains configuration, directive syntax, glob precedence, CLI workflows, provider security, dry-run/write safety, migration outputs, and supported replacement scope.
- [ ] The glossary consistently uses the agreed domain terms and no longer contradicts implemented behavior.
- [ ] Vue 2, Vue 3, and generic JavaScript fixtures demonstrate the supported replacement adapters.
- [ ] Automated coverage spans exclusion directives, glob/config behavior, catalog export, fake-provider failures, human-translation protection, review markers, dry-run, writes, idempotency, and rollback.
- [ ] The complete repository test suite is reproducible without an API key, vendor SDK, or outbound network request.
