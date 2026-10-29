# i18n-collect Resources

## Knowledge

- [Repository README](README.md)
  The executable product contract: supported sources, configuration, integration, commands, files, exit codes, and deliberate limits. Use first for externally observable behavior.
- [Collection architecture record](docs/collection-architecture.md)
  The primary design record for the loader-owned collection pipeline, resource snapshots, Webpack lifecycle, cache behavior, and transactional publication.
- [Collection troubleshooting guide](docs/collection.md)
  Operational explanation of watch behavior, failed rounds, loader integration diagnostics, output freshness, and common collection failures.
- [Project domain glossary](CONTEXT.md)
  Canonical vocabulary for collected text, semantic kinds, resource snapshots, catalogs, replacement, and review state. Use these terms consistently.
- [Webpack loaders documentation](https://webpack.js.org/concepts/loaders/)
  Primary framework reference for loader chaining and the transformation boundary.
- [Webpack plugin API documentation](https://webpack.js.org/api/plugins/)
  Primary framework reference for compiler and compilation lifecycle hooks used by the plugin.
- [Webpack loader API documentation](https://webpack.js.org/api/loaders/)
  Primary framework reference for loader context, pitch execution, dependency tracking, and transparent callbacks.

## Wisdom (Communities)

- [Webpack Discussions](https://github.com/webpack/webpack/discussions)
  Use for framework-level questions involving loader pitch order, compilation caches, and plugin lifecycle behavior after reducing the issue to a minimal reproduction.
- [Vue Land Discord](https://vue-land.js.org/)
  Use for current Vue integration questions, particularly vue-loader and Vue I18n runtime conventions.

## Gaps

- There is no public API reference generated from this package. The checked-out source and tests are the authoritative implementation-level reference.
