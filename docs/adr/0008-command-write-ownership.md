# Command write ownership

## Status

Accepted

## Decision

Write ownership is split by command:

- **Scan** writes source analysis outputs only (source catalog and machine-readable analysis report).
- **Translate** writes target translation outputs only.
- **Build** is read-only for localization artifacts; it may rewrite in-memory modules and emitted build output, never source catalogs, audit reports, target catalogs, or translation state.
- **Check** is read-only; it evaluates project localization completeness and writes no project files.
- **Replace** previews by default and writes application source only when explicitly requested; it does not write catalogs or maintain replacement bookkeeping files.
- **Migrate-keys** is a one-shot exception that may rewrite the source-locale catalog, target catalogs, and `source-catalog.json` together when converting per-occurrence automatic keys to exact-text hash keys. Conflicts write nothing. It does not replace Scan or Translate for ordinary rounds.

A command must not take write ownership that belongs to another command, except the migrate-keys exception above.

## Considered options

- **Let build refresh catalogs during compilation:** rejected because production builds would mutate committed localization state and hide staleness.
- **Combine scan and translate into one write:** rejected because source discovery and target acceptance have different failure and review boundaries.
- **Keep replacement metadata as a side database:** rejected because version control of source is the rollback mechanism once catalogs are no longer rewritten by replace.
