# Vue 2 demo

Webpack / Vue CLI demo for **scan → translate → build** (read-only Build replacement), locale switching, optional Source replacement, explicit messages, and audited HTML/CSS samples.

Forbidden interpolation and concatenation patterns live under `fixtures/` (excluded from scan). Live pages use `$t(...)` plus `lang/catalog/explicit-messages.json` where variables are required.

## Audit dispositions

Included Chinese on standalone HTML (`public/index.html`) and CSS (`src/base.css`) uses adjacent `i18n-ignore: <reason>` so `check` reports disposition `intentionally-ignored`. Those findings never receive catalog keys. Unresolved or needs-review audits would block completeness.

## Commands

```
npm run scan
npm run check
npm run build
```

From the repository root:

```
npx i18n-collect scan --cwd apps/demo
npx i18n-collect check --cwd apps/demo
npx i18n-collect replace --cwd apps/demo --adapter vue2
npx i18n-collect replace --cwd apps/demo --adapter vue2 --write
```

`replace` is preview-only unless `--write` is set. It rewrites supported application source only; catalogs stay untouched.

After `scan`, sync `lang/catalog/zh.json` from `lang/catalog/source-catalog.json`, keep `lang/catalog/en.json` and `lang/catalog/translation-state.json` in sync, then run `check`.
