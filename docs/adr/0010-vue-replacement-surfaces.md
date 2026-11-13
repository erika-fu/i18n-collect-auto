# Vue replacement surfaces

## Status

Accepted. Supersedes ADR-0006 for Webpack in-memory replacement and clarifies ADR-0002 and ADR-0004.

## Decision

Vue replacement uses different source surfaces for different workflows. During Webpack `collect --replace`, the loader receives compiler-generated Vue render-function JavaScript, analyzes that render source, and rewrites it in memory with the Vue runtime helper. It neither writes nor reparses the original `.vue` template in that replacement path.

The explicit source-replacement workflow (`replace --write`) operates on original `.vue` source and its template ranges, because its purpose is to write a readable localization call back to application source. The two workflows share message and replacement policy where possible, but their edit coordinates and transformed surfaces are intentionally different.

## Consequences

- Documentation must name the workflow before claiming a Vue replacement surface.
- Webpack collection replacement can use compiler-generated prop and child shapes, while source replacement preserves `.vue` template syntax.
- A change to either route must preserve the common catalog key and replacement-policy contracts without assuming their locations are interchangeable.
