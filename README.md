# i18n-collect

Discover Chinese user-facing copy via Webpack collection, keep runtime-localizable messages in translation catalogs, audit standalone HTML and styles separately, and optionally apply Build or Source replacement. Vue 2, Vue 3, and React demos live beside the `i18n-collect` package.

Primary workflow:

1. **collect** — Webpack module-graph collection; atomically publishes `source-catalog.json`, `analysis-report.json`, and dictionary outputs. Add `--replace` to replace eligible runtime messages in the same loader pass and emit the configured bundle without changing application source files.
2. **translate** — fill target-locale catalogs (and translation state) only. Independent of Webpack; no network during compilation.
3. **build** — verify collection outputs by default; legacy Build replacement into the formal webpack bundle only (no catalog mutation unless `--write-collection`). Prefer `collect --replace` when collection and in-memory replacement should occur in one compilation.
4. **replace** — preview Source replacement; write application source only with `--write`.
5. **check** — read-only project localization completeness (freshness, coverage, audits, translations, hybrid policy).

One-shot: **migrate-keys** converts legacy per-occurrence automatic keys to deterministic exact-text hash keys.

Filesystem **scan** remains available as a non-Webpack / legacy analysis path. Superseded commands (`verify`, `run`, `check-policy`) fail with a bounded migration error. See [docs/migration.md](docs/migration.md).

- `packages/i18n-collect` — CLI, analysis, replacement, and webpack Build replacement helpers.
- `apps/demo` — Vue 2 / Vue CLI demo (`vue2` adapter, vue-i18n 8).
- `apps/vue3-demo` — Vue 3 / Webpack 5 demo (`vue3` adapter, vue-i18n 9).
- `apps/react-demo` — React / Webpack 5 demo for collect, explicit messages, and check. React JSX is outside Build/Source replacement for v1.

## Setup

```
npm install
```

### Development and production

```
npm run serve
npm run build
npm run build-vue3-demo
npm run build-react-demo
npm run regression
```

`npm run build` and `npm run build-vue3-demo` run verify-by-default `i18n-collect build`. Refresh catalogs with `collect` (then sync the source-locale runtime catalog) and `translate` when needed. Watch variants: `npm run watch -w i18n-auto-webpack-demo` and `npm run watch -w i18n-auto-webpack-vue3-demo`. Collection watch: `npm run collect:watch -w i18n-auto-webpack-demo`.

`npm test` runs the package suite, including migration fixtures under `packages/i18n-collect/fixtures/replacement` and the Webpack runtime collection end-to-end regression in `packages/i18n-collect/test/webpack-runtime-collection-regression.test.js`.

`npm run regression` runs package tests, all three demo builds, then the hybrid localization gate with `--skip-package-tests`.

Refresh committed collection outputs for demos:

```
npm run update-demo-collection
npm run update-vue3-demo-collection
npm run update-react-demo-collection
```

### Hybrid-localization quality gate

`npm run verify` is the local / CI entry point. It:

1. Runs read-only `i18n-collect check` on the React demo.
2. Builds the Vue 2 demo, fails if formal localization outputs would change, then runs `check`.
3. Builds the Vue 3 demo the same way, then runs `check`.
4. Runs the package test suite.
5. Runs the React demo production build without hidden catalog mutation.

```
npm run verify
npx i18n-collect check --cwd apps/react-demo
npx i18n-collect check --json
npx i18n-collect check --help
```

| Failure category | Typical exit | What to do |
| --- | --- | --- |
| `configuration` | 1 | Fix config or command options, then re-run. |
| `collection` / incomplete | 2 | Fix analysis, run `collect`, dispose audits, or complete translations. |
| `build` | 3 | Fix the webpack/demo build, then re-run. |
| `policy` | 8 | Fix completeness / hybrid policy findings reported by `check`. |
| `stale` | 9 | Re-collect (and sync runtime catalogs) and commit updated artifacts. |
| `tests` | 10 | Fix failing package tests (`npm test -w i18n-collect`). |
| `demo-build` | 11 | Fix the React demo production build. |

## Commands

```
npx i18n-collect collect --help
npx i18n-collect translate --help
npx i18n-collect build --help
npx i18n-collect replace --help
npx i18n-collect check --help
npx i18n-collect migrate-keys --help
```

Runtime-localizable messages receive keys and enter catalogs. Chinese source audit findings (standalone HTML and styles until an adapter exists) never receive keys; dispose them with migration, a future adapter, or `i18n-ignore: <reason>`.

## Webpack 5 Build replacement

The package peer dependency is webpack 5. Vite and Rollup are not supported for Build replacement.

`apps/demo` and `apps/vue3-demo` show supported Build replacement shapes (`buildReplacement` in `i18n-collect.config.js`). React JSX replacement is out of scope for v1; see `apps/react-demo/README.md`.

## Further reading

- [docs/migration.md](docs/migration.md) — command renames, per-occurrence catalogs, removed state files.
- [docs/webpack-runtime-collection-design.md](docs/webpack-runtime-collection-design.md) — Webpack collection ownership.
- [CONTEXT.md](CONTEXT.md) — domain vocabulary.
- [docs/adr/0008-command-write-ownership.md](docs/adr/0008-command-write-ownership.md) — write ownership.
- Demo READMEs under `apps/demo`, `apps/vue3-demo`, and `apps/react-demo`.
