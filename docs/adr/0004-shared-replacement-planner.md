# ADR-0004: Shared replacement planner

## Status

Accepted for the shared pure planner boundary. Workflow write ownership and Vue/audit constraints follow ADR-0006, ADR-0007, and ADR-0008.

## Context

Source replacement rewrites supported source locations into runtime
localization calls. Build replacement will make the same decision against an
in-memory module and emitted build output. The two workflows must agree about
source ranges, AST and Vue template positions, adapter call selection,
already-localized calls, and overlapping edits.

File access, catalog lifecycle, and transactional writes belong to the CLI or
build integration. They are not part of the replacement decision and cannot be
shared safely through those integration objects.

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
catalog, inspect webpack objects, install dependencies, or own localization
artifact writes. Build replacement applies returned edits only to its in-memory
module and build artifact. Source replacement applies returned edits to
application source only when explicitly requested (ADR-0008). Vue edits target
original template surfaces before compilation (ADR-0006). HTML and style audit
findings are not planner inputs (ADR-0007).

New runtime-localizable messages require a successful scan to place a stable
localization key in the source catalog before either replacement workflow may
consume them. The planner never derives or allocates localization keys.

## Consequences

- Source and build replacement share one authority for matching and call
  selection.
- Runtime integration checks stay at the workflow boundary; the planner does
  not bootstrap Vue or import a localization module.
- Planner tests can run without a project filesystem or webpack compilation.
- Scan assigns keys; replacement only consumes them. A single compilation
  cannot safely analyze text, assign durable keys, and replace source in one
  undifferentiated operation.
