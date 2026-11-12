# Migration guide

This project moved from legacy `verify` / `check-policy` / `run` workflows to a product surface of **collect**, **translate**, **build**, **replace**, and **check**, with filesystem **scan** kept as a non-Webpack / legacy analysis path. Use `migrate-keys` once for legacy catalogs.

## Command map

| Old | New |
| --- | --- |
| Filesystem-only discovery as the only publisher | `i18n-collect collect` for Webpack module-graph publication of `source-catalog.json` / `analysis-report.json` / dictionary outputs; `i18n-collect scan` remains for filesystem analysis |
| `i18n-collect verify` | `i18n-collect collect` then `i18n-collect check` |
| `i18n-collect check-policy` | `i18n-collect check` (policy is part of completeness) |
| `i18n-collect run ...` | Call `collect`, `translate`, `replace`, `build`, and `check` directly |
| Build that refreshed catalogs | `i18n-collect build` verifies collection outputs by default; refresh catalogs with `collect` / `translate`. Explicit `build --write-collection` is required before a build may publish collection outputs |

Removed commands (`verify`, `check-policy`, `run`) exit with configuration failure and a short migration message.

## Write ownership

- **collect** runs a Webpack collection compilation and atomically publishes `source-catalog.json`, `analysis-report.json`, and runtime dictionary / source-map outputs. `collect --watch` publishes after successful rounds and preserves previous outputs after failed rounds.
- **scan** writes `source-catalog.json` and `analysis-report.json` only (filesystem path; does not dual-write the Webpack dictionary).
- **translate** writes target-locale catalogs and `translation-state.json` only. Independent of Webpack; does not issue network requests during compilation.
- **build** verifies committed collection outputs by default and may rewrite in-memory modules and emitted bundles. It does not mutate catalogs unless `--write-collection` is explicitly set (development build-write mode).
- **replace** previews by default; with `--write` it writes application source only.
- **check** writes nothing. Unresolved and needs-review findings block completeness.
- **migrate-keys** may rewrite the source-locale catalog, target catalogs, and `source-catalog.json` together for the one-shot key migration.

After `collect`, keep the runtime source-locale catalog (`zh.json`) aligned with `source-catalog.json` when the app loads that file at runtime.

## Per-occurrence catalogs

Catalogs that still use `auto.<ULID>` occurrence identities, occurrence IDs, orphan statuses, or identity ambiguity / confirmation / retirement files must run:

```
npx i18n-collect migrate-keys
npx i18n-collect collect
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

`check` reports both layers. Completeness requires fresh collection outputs, no blocking explicit-required copy, disposed audits, complete target translations, and clean hybrid policy (complete-static-copy baseline + runtime-multilingual boundaries).
