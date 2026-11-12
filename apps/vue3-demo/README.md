# Vue 3 demo

Standalone Webpack 5 + vue-loader 17 demo for **collect → translate → build** (verify-by-default Build replacement), locale switching, optional Source replacement (`vue3` adapter), and audited HTML/CSS samples.

Interpolation teaching samples that would hard-fail collection are kept under `fixtures/`. Live copy uses `$t(...)` plus `lang/catalog/explicit-messages.json` where variables are required.

## Audit dispositions

`public/index.html` and `src/base.css` include intentional Chinese audit findings with adjacent `i18n-ignore: <reason>`. `check` reports them as disposition `intentionally-ignored`; they never receive catalog keys.

## Commands

```
npm run collect
npm run check
npm run build
npm run replace
```

From the repository root:

```
npx i18n-collect collect --cwd apps/vue3-demo
npx i18n-collect check --cwd apps/vue3-demo
npx i18n-collect replace --cwd apps/vue3-demo --adapter vue3
npx i18n-collect replace --cwd apps/vue3-demo --adapter vue3 --write
```

`replace` is preview-only unless `--write` is set. `build` verifies committed collection outputs by default.

After `collect`, sync `lang/catalog/zh.json` from `lang/catalog/source-catalog.json`, keep translations current, then run `check`.
