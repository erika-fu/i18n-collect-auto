# Vue replacement before template compilation

## Status

Superseded by ADR-0010. The current implementation distinguishes source replacement from Webpack in-memory collection replacement; this ADR's single original-template surface does not describe the Webpack `collect --replace` path.

## Historical decision

This ADR required all Vue replacement to rewrite original template text and attributes before compilation. The current source-replacement workflow still uses original `.vue` source, but the Webpack `collect --replace` workflow receives and rewrites compiler-generated render-function JavaScript. See ADR-0010 for the current rule.

## Historical alternatives

- **Replace inside generated render functions:** previously rejected because Vue static optimizations could freeze locale-specific strings into render output.
- **Treat Vue like plain JavaScript string replacement after compilation:** previously rejected because template structure, attribute bindings, and compiler ownership would be lost.

These alternatives are retained only as historical context; ADR-0010 records the current implementation's distinct source and Webpack surfaces.
