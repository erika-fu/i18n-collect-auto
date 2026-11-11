# React demo

This demo shows webpack 5 collection, explicit localization calls, and a runtime-multilingual boundary panel.

## Build replacement scope

React JSX is **outside** Build replacement for v1. Do not enable `buildReplacement` here or run `i18n-collect build` against this app expecting JSX text or attributes to become localization calls. Collection still records JavaScript strings and template-literal segments inside `.jsx` modules. Explicit `t()` calls and the multilingual panel remain the supported path for runtime locale switching.

Use the Vue 2 (`apps/demo`) and Vue 3 (`apps/vue3-demo`) demos for Build replacement end-to-end: Chinese stays on disk, catalogs receive stable keys, and the formal bundle renders through runtime localization calls.

## Commands

```
npm run build
npx i18n-collect collect --cwd apps/react-demo
npx i18n-collect verify --cwd apps/react-demo
```
