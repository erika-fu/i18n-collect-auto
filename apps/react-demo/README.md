# React demo

This demo shows Webpack **collect → review → translate → check**, explicit localization calls (`t(...)` + `explicit-messages.json`), a runtime-multilingual boundary panel, and Chinese source audit findings with documented dispositions. It does **not** claim JSX Source or Build replacement.

## Dynamic message review

Supported exception for this demo: React JSX text and attributes are outside Build/Source replacement and proven-safe `review --write` for v1. Live user-facing copy is already expressed as explicit `t(...)` calls (`react.app.title`, `react.app.taskSummary`, multilingual keys). Whole-expression discovery, Translate decisions, and proven-safe `--write` are demonstrated on the Vue 2 and Vue 3 demos.

Project input: `lang/catalog/dynamic-message-decisions.json` (empty when no live candidates remain). Refresh formal outputs with `collect` and keep catalogs aligned—do not hand-edit generated reports.

```
npm run collect
npm run review -- --status needs-review
npm run collect
# Sync lang/catalog/zh.json from lang/catalog/source-catalog.json messages
# npm run translate   # when a translationProvider is configured
npm run check
```

See [Dynamic message review](../../docs/dynamic-message-review.md).

## Build / Source replacement scope

React JSX is **outside** Build and Source replacement for v1. Do not enable `buildReplacement` or run `i18n-collect build` / `replace --adapter js` expecting JSX text or attributes to become localization calls. Use `i18n-collect collect` for Webpack module-graph collection and `check` for completeness. Explicit `t()` calls and the multilingual panel are the supported runtime path.

Use the Vue 2 (`apps/demo`) and Vue 3 (`apps/vue3-demo`) demos for Build replacement, optional Source replacement, and proven-safe `review --write` end-to-end.

## Audit dispositions

`public/index.html` and `src/base.css` keep representative Chinese audit samples with adjacent `i18n-ignore: <reason>` so `check` reports `intentionally-ignored`.

## Commands

```
npm run collect
npm run review
npm run translate
npm run check
npm run build
```

From the repository root:

```
npx i18n-collect collect --cwd apps/react-demo
npx i18n-collect review --cwd apps/react-demo
npx i18n-collect translate --cwd apps/react-demo
npx i18n-collect check --cwd apps/react-demo
```
