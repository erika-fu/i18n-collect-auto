# Vue 3 demo

Standalone Webpack 5 + vue-loader 17 demo for **collect → review → translate → build** (verify-by-default Build replacement), locale switching, optional Source replacement (`vue3` adapter), and audited HTML/CSS samples.

Live copy uses `$t(...)` plus `lang/catalog/explicit-messages.json` where variables are required (for example `vue3.welcomeBack`, `vue3.fieldPlaceholder`). Pre-migration interpolation samples stay under `fixtures/` (excluded from Webpack collection) for filesystem **scan** and **review** teaching. See [Dynamic message review](../../docs/dynamic-message-review.md).

## Dynamic message review

Project input: `lang/catalog/dynamic-message-decisions.json` (empty when no live candidates remain). Refresh through the product commands—do not hand-edit generated collection outputs.

```
npm run collect
npm run review -- --status needs-review
# npx i18n-collect review <id> --cwd . --translate --key <key> --source '<text>' --yes
# npx i18n-collect review <id> --cwd . --write --adapter vue3 --yes
npm run collect
# Sync lang/catalog/zh.json from lang/catalog/source-catalog.json messages
# npm run translate   # when a translationProvider is configured
npm run check
```

## Audit dispositions

`public/index.html` and `src/base.css` include intentional Chinese audit findings with adjacent `i18n-ignore: <reason>`. `check` reports them as disposition `intentionally-ignored`; they never receive catalog keys.

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
npx i18n-collect collect --cwd apps/vue3-demo
npx i18n-collect review --cwd apps/vue3-demo
npx i18n-collect check --cwd apps/vue3-demo
npx i18n-collect replace --cwd apps/vue3-demo --adapter vue3
npx i18n-collect replace --cwd apps/vue3-demo --adapter vue3 --write
```

`replace` is preview-only unless `--write` is set. `build` verifies committed collection outputs by default.

After `collect`, sync `lang/catalog/zh.json` from `lang/catalog/source-catalog.json`. Keep target catalogs aligned (via `translate` when a provider is configured), then run `check`.
