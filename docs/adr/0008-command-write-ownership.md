# Command write ownership

## Status

Accepted (revised for Webpack collection ownership)

## Decision

Write ownership is split by command:

- **Collect** runs a Webpack collection compilation and atomically publishes source analysis outputs (`source-catalog.json`, `analysis-report.json`) together with the runtime dictionary / source-map pair derived from the live module graph. `collect --watch` publishes after each successful round and preserves previous formal outputs after a failed round.
- **Scan** remains a filesystem analysis path that writes source analysis outputs only (source catalog and machine-readable analysis report). It does not dual-write the Webpack dictionary.
- **Translate** writes target translation outputs only. It is independent of Webpack and does not issue network requests during compilation.
- **Build** verifies committed collection outputs against the current compilation by default. It may rewrite in-memory modules and emitted build output. It must not mutate source catalogs, audit reports, target catalogs, or translation state unless an explicitly enabled development build-write mode (`--write-collection`) is set for that invocation.
- **Check** is read-only; it evaluates project localization completeness and writes no project files. Unresolved and needs-review audit findings, dynamic message candidates still `needs-review` or still `translation-approved`, and deferred candidates under the default error policy block completeness.
- **Replace** previews by default and writes application source only when explicitly requested; it does not write catalogs or maintain replacement bookkeeping files.
- **Review** owns the version-controlled dynamic decision manifest (`dynamic-message-decisions.json`) and, for Translate decisions, atomically updates that manifest together with `explicit-messages.json`. It does not rewrite application source unless a separately confirmed proven-safe write mode is used; it does not publish collection outputs or target catalogs.
- **Migrate-keys** is a one-shot exception that may rewrite the source-locale catalog, target catalogs, and `source-catalog.json` together when converting per-occurrence automatic keys to exact-text hash keys. Conflicts write nothing. It does not replace Collect/Scan or Translate for ordinary rounds.

A command must not take write ownership that belongs to another command, except the migrate-keys exception and the explicit build `--write-collection` development mode above.

## Considered options

- **Let every production build refresh catalogs during compilation:** rejected because production builds would mutate committed localization state and hide staleness.
- **Forbid build from ever publishing collection outputs:** rejected for development convenience; an explicit `--write-collection` flag is required instead of silent publish.
- **Combine collect and translate into one write:** rejected because source discovery and target acceptance have different failure and review boundaries.
- **Keep replacement metadata as a side database:** rejected because version control of source is the rollback mechanism once catalogs are no longer rewritten by replace.
