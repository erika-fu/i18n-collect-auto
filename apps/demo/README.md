# Vue 2 demo

Webpack / Vue CLI demo for **collect → translate → build** (verify-by-default Build replacement), locale switching, optional Source replacement (`vue2` adapter), explicit messages, and audited HTML/CSS samples.

Interpolation and concatenation samples that currently fail the complete-static-copy policy live under `fixtures/` (excluded from collection). Live pages use `$t(...)` plus `lang/catalog/explicit-messages.json` where variables are required. The accepted next design will retain these forms as location-bearing review candidates instead; see [Dynamic message review](../../docs/dynamic-message-review.md).

## Audit dispositions

Included Chinese on standalone HTML (`public/index.html`) and CSS (`src/base.css`) uses adjacent `i18n-ignore: <reason>` so `check` reports disposition `intentionally-ignored`. Those findings never receive catalog keys. Unresolved or needs-review audits would block completeness.

## Commands

```
npm run collect
npm run check
npm run build
npm run replace
```

From the repository root:

```
npx i18n-collect collect --cwd apps/demo
npx i18n-collect check --cwd apps/demo
npx i18n-collect replace --cwd apps/demo --adapter vue2
npx i18n-collect replace --cwd apps/demo --adapter vue2 --write
```

`replace` is preview-only unless `--write` is set. It rewrites supported application source only; catalogs stay untouched. `build` verifies committed collection outputs by default; use `build --write-collection` only for an explicit development publish.

After `collect`, sync `lang/catalog/zh.json` from `lang/catalog/source-catalog.json`, keep `lang/catalog/en.json` and `lang/catalog/translation-state.json` in sync, then run `check`.
