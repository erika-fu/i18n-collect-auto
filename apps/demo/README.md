# Vue 2 demo

Webpack / Vue CLI demo for **collect → review → translate → build** (verify-by-default Build replacement), locale switching, optional Source replacement (`vue2` adapter), explicit messages, and audited HTML/CSS samples.

Live pages keep complete static copy as automatic messages and use `$t(...)` plus `lang/catalog/explicit-messages.json` for formerly dynamic copy (for example `demo.welcomeBack`). Pre-migration interpolation and concatenation samples live under `fixtures/` (excluded from Webpack collection); use filesystem **scan** against those fixtures when you want to reproduce discovery → **review** → proven-safe `--write`. See [Dynamic message review](../../docs/dynamic-message-review.md).

## Dynamic message review

Project input: `lang/catalog/dynamic-message-decisions.json` (empty when every live candidate is already migrated or none remain). Collection regenerates candidate dispositions into `analysis-report.json`; do not hand-edit generated reports.

Typical refresh after source changes:

```
npm run collect
npm run review -- --status needs-review
# For each unresolved candidate, decide then optionally write:
# npx i18n-collect review <id> --cwd . --translate --key <key> --source '<text>' --yes
# npx i18n-collect review <id> --cwd . --write --adapter vue2 --yes
npm run collect
# Sync lang/catalog/zh.json from lang/catalog/source-catalog.json messages
# npm run translate   # when a translationProvider is configured
npm run check
```

## Audit dispositions

Included Chinese on standalone HTML (`public/index.html`) and CSS (`src/base.css`) uses adjacent `i18n-ignore: <reason>` so `check` reports disposition `intentionally-ignored`. Those findings never receive catalog keys. Unresolved or needs-review audits would block completeness.

## Commands

```
npm run collect
npm run review
npm run translate
npm run check
npm run build
npm run replace
```

From the repository root:

```
npx i18n-collect collect --cwd apps/demo
npx i18n-collect review --cwd apps/demo
npx i18n-collect check --cwd apps/demo
npx i18n-collect replace --cwd apps/demo --adapter vue2
npx i18n-collect replace --cwd apps/demo --adapter vue2 --write
```

`replace` is preview-only unless `--write` is set. It rewrites supported application source only; catalogs stay untouched. `build` verifies committed collection outputs by default; use `build --write-collection` only for an explicit development publish.

After `collect`, sync `lang/catalog/zh.json` from `lang/catalog/source-catalog.json`. Keep `lang/catalog/en.json` and `lang/catalog/translation-state.json` aligned (via `translate` when a provider is configured, or by updating committed targets). Then run `check`.
