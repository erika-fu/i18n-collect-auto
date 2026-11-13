# Migration guide

This project moved from legacy `verify` / `check-policy` / `run` workflows to a product surface of **collect**, **translate**, **build**, **replace**, **review**, and **check**, with filesystem **scan** kept as a non-Webpack / legacy analysis path. Use `migrate-keys` once for legacy catalogs.

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

- **collect** runs a Webpack collection compilation and atomically publishes `source-catalog.json`, `analysis-report.json`, and runtime dictionary / source-map outputs. `collect --replace` also rewrites eligible runtime messages in the same collection loader pass and emits the configured bundle, without changing application source files. `collect --watch` publishes after successful rounds and preserves previous outputs after failed rounds; it cannot be combined with `--replace`.
- **scan** writes `source-catalog.json` and `analysis-report.json` only (filesystem path; does not dual-write the Webpack dictionary).
- **translate** writes target-locale catalogs and `translation-state.json` only. Independent of Webpack; does not issue network requests during compilation.
- **build** verifies committed collection outputs by default and may rewrite in-memory modules and emitted bundles. It does not mutate catalogs unless `--write-collection` is explicitly set (development build-write mode).
- **replace** previews by default; with `--write` it writes application source only.
- **check** writes nothing. It evaluates runtime localization coverage, Chinese source audit disposition, **dynamic message candidate** dispositions, target translations, and hybrid policy. Candidates still `needs-review` (never reviewed) and candidates still `translation-approved` (awaiting verified migration) block completeness; deferred candidates follow `deferredDynamicCandidates` (`error` by default). Unresolved or needs-review audits also block.
- **review** owns `dynamic-message-decisions.json` and, for Translate, atomically updates that file with `explicit-messages.json`. After Translate, separately confirmed `--write` may migrate only proven-safe concatenation and template-literal expressions; `--apply` is not accepted.
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

## Runtime catalog messages vs dynamic candidates vs audit findings

- **Runtime-localizable messages** enter `source-catalog.json`, receive keys, and can be translated / replaced / build-replaced. This includes both automatically collected complete static copy and validated explicit localization calls; explicit canonical source and placeholder contracts remain owned by `explicit-messages.json`.
- **Dynamic message candidates** are whole-expression findings in `analysis-report.json` for interpolation, concatenation, conditional construction, formatting, and structured copy. They do not receive translation keys, enter catalogs, or receive automatic replacement. Dispose them with **Review** (translate through an explicit message, intentionally ignore with a reason, or defer; optional proven-safe `--write` after Translate).
- **Superseded fragment model:** historical fragment-level `explicitRequiredFindings` are no longer published. Treat any older notes that describe them as migration history.
- **Chinese source audit findings** (standalone HTML, proven CSS `content`, conservative preprocessor candidates) never receive keys and never enter catalogs. Dispose them by migrating to a runtime-localizable surface, adding a real adapter later, or an adjacent `i18n-ignore: <reason>` directive.

`check` reports runtime messages, dynamic-candidate dispositions, and audits. Completeness requires fresh collection outputs, disposed audits and dynamic candidates (per policy), complete target translations, and clean hybrid policy (complete-static-copy baseline + runtime-multilingual boundaries). See [Dynamic message review](dynamic-message-review.md).
