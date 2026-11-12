# Migration guide

This project moved from legacy `verify` / `check-policy` / `run` workflows to a product surface of **scan**, **collect**, **translate**, **build**, **replace**, and **check**. Use `migrate-keys` once for legacy catalogs.

## Command map

| Old | New |
| --- | --- |
| Filesystem-only discovery | `i18n-collect scan` for `source-catalog.json` / `analysis-report.json`; `i18n-collect collect` for Webpack module-graph runtime dictionary outputs |
| `i18n-collect verify` | `i18n-collect scan` then `i18n-collect check` |
| `i18n-collect check-policy` | `i18n-collect check` (policy is part of completeness) |
| `i18n-collect run ...` | Call `scan`, `collect`, `translate`, `replace`, `build`, and `check` directly |
| Build that refreshed catalogs | `i18n-collect build` is read-only for localization artifacts; refresh catalogs with `scan` / `translate` (and Webpack dictionary via `collect`) |

Removed commands (`verify`, `check-policy`, `run`) exit with configuration failure and a short migration message.

## Write ownership

- **scan** writes `source-catalog.json` and `analysis-report.json` only.
- **collect** runs a Webpack collection compilation and publishes runtime dictionary / source-map outputs from the live module graph.
- **translate** writes target-locale catalogs and `translation-state.json` only.
- **build** may rewrite in-memory modules and emitted bundles; it does not mutate catalogs.
- **replace** previews by default; with `--write` it writes application source only.
- **check** writes nothing.
- **migrate-keys** may rewrite the source-locale catalog, target catalogs, and `source-catalog.json` together for the one-shot key migration.

After `scan`, keep the runtime source-locale catalog (`zh.json`) aligned with `source-catalog.json` when the app loads that file at runtime.

## Per-occurrence catalogs

Catalogs that still use `auto.<ULID>` occurrence identities, occurrence IDs, orphan statuses, or identity ambiguity / confirmation / retirement files must run:

```
npx i18n-collect migrate-keys
npx i18n-collect scan
```

Conflicts (same source text with disagreeing historical target translations) write nothing; assign explicit keys, then retry. Remove unused `identity-confirmations.json`, `identity-ambiguities.json`, and `retirement-confirmations.json` after a successful migration.

## Conflicting historical translations

When several old automatic keys shared equal source text but different target translations, `migrate-keys` stops with a report. Give each contextual message an explicit key (`i18n-key` or `explicit-messages.json`), then re-run migration.

## Removed state files and concepts

These are no longer part of the supported product:

- Occurrence identity, structural-anchor recovery, orphan retirement, and `pruneOrphaned`
- Replacement bookkeeping / `replacements.json`
- Full preprocessor Style IR collection (styles are Chinese source audit surfaces)

## Runtime catalog messages vs audit-only findings

- **Runtime-localizable messages** enter `source-catalog.json`, receive keys, and can be translated / replaced / build-replaced.
- **Chinese source audit findings** (standalone HTML, proven CSS `content`, conservative preprocessor candidates) never receive keys and never enter catalogs. Dispose them by migrating to a runtime-localizable surface, adding a real adapter later, or an adjacent `i18n-ignore: <reason>` directive.

`check` reports both layers. Completeness requires fresh scan outputs, no blocking explicit-required copy, disposed audits, complete target translations, and clean hybrid policy (complete-static-copy baseline + runtime-multilingual boundaries).
