# ADR-0004: Shared replacement planner

## Status

Accepted

## Context

Source replacement rewrites supported source locations into runtime
localization calls. Build replacement will make the same decision against an
in-memory module and emitted build output. The two workflows must agree about
source ranges, AST and Vue template positions, adapter call selection,
already-localized calls, identity ambiguity, and overlapping edits.

File access, catalog lifecycle, replacement metadata, and transactional writes
belong to the CLI or build integration. They are not part of the replacement
decision and cannot be shared safely through those integration objects.

## Decision

Use one pure `ReplacementPlanner` interface for source replacement and build
replacement. It accepts:

- keyed catalog occurrences;
- immutable resource snapshots and their project-relative identities;
- the selected replacement adapter;
- configured style and Vue parser information;
- runtime capabilities that have already been verified by the caller.

It returns deterministic replacement edits, already-recognized localized
occurrences, skipped occurrences with reasons, and any planning failure.

The planner does not read or write files, load project configuration, submit a
catalog, inspect webpack objects, install dependencies, or commit replacement
metadata. Source replacement remains responsible for reading resources,
reconciling replacement metadata, and committing source, catalogs, and metadata
transactionally. Build replacement remains responsible for applying the
returned edits only to its in-memory module and build artifact.

New occurrences require a successful collection round to assign a stable
localization key before either replacement workflow may consume them. The
planner never derives or allocates localization keys.

## Consequences

- Source and build replacement share one authority for matching and call
  selection.
- Runtime integration checks stay at the workflow boundary; the planner does
  not bootstrap Vue or import a localization module.
- Planner tests can run without a project filesystem or webpack compilation.
- Replacement metadata remains source-replacement audit and rollback data,
  rather than a hidden input to build replacement.
- Collection and key assignment remain a first stage, and replacement remains
  a later consumer stage. A single compilation cannot safely collect text,
  assign durable keys, and replace source in one undifferentiated operation.
