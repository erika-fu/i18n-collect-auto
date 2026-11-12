# i18n-collect Resources

## Knowledge

- [Repository README](README.md)
  The executable product contract: supported sources, configuration, integration, commands, files, exit codes, and deliberate limits. Use first for externally observable behavior.
- [Migration guide](docs/migration.md)
  Old command names, per-occurrence catalogs, removed state files, and the bounded migration errors returned by superseded workflows.
- [Project domain glossary](CONTEXT.md)
  Canonical vocabulary for runtime-localizable messages, Chinese source audit findings, catalogs, replacement, and review state. Use these terms consistently.
- [Command write ownership ADR](docs/adr/0008-command-write-ownership.md)
  Which workflow command may write which artifacts.
- [Webpack loaders documentation](https://webpack.js.org/concepts/loaders/)
  Primary framework reference for loader chaining used by Build replacement.
- [Webpack plugin API documentation](https://webpack.js.org/api/plugins/)
  Primary framework reference for compiler and compilation lifecycle hooks used by Build replacement.
- [Webpack loader API documentation](https://webpack.js.org/api/loaders/)
  Primary framework reference for loader context, normal-phase transforms, dependency tracking, and transparent callbacks. Collection uses the active Webpack source flow rather than pitch-phase disk rereads.

## Wisdom (Communities)

- [Webpack Discussions](https://github.com/webpack/webpack/discussions)
  Use for framework-level questions involving loader order, compilation caches, and plugin lifecycle behavior after reducing the issue to a minimal reproduction.
- [Vue Land Discord](https://vue-land.js.org/)
  Use for current Vue integration questions, particularly vue-loader and Vue I18n runtime conventions.

## Gaps

- There is no public API reference generated from this package. The checked-out source and tests are the authoritative implementation-level reference.
