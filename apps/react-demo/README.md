# React demo

This demo shows explicit localization calls (`t(...)` + `explicit-messages.json`), a runtime-multilingual boundary panel, and Chinese source audit findings with documented dispositions. It does **not** claim JSX Source or Build replacement.

## Build / Source replacement scope

React JSX is **outside** Build and Source replacement for v1. Do not enable `buildReplacement` or run `i18n-collect build` / `replace --adapter js` expecting JSX text or attributes to become localization calls. Use `i18n-collect scan` for source analysis and `check` for completeness. Explicit `t()` calls and the multilingual panel are the supported runtime path.

Use the Vue 2 (`apps/demo`) and Vue 3 (`apps/vue3-demo`) demos for Build replacement and optional Source replacement end-to-end.

## Audit dispositions

`public/index.html` and `src/base.css` keep representative Chinese audit samples with adjacent `i18n-ignore: <reason>` so `check` reports `intentionally-ignored`.

## Commands

```
npm run scan
npm run check
npm run build
```

From the repository root:

```
npx i18n-collect scan --cwd apps/react-demo
npx i18n-collect check --cwd apps/react-demo
```
