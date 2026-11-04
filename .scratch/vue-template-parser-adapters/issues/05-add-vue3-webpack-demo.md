# 05: Add a Vue 3 webpack collection demo

**What to build:** Add an independent Vue 3 application that demonstrates the real webpack loader lifecycle, native Vue 3 template parsing, collection outputs, and runtime localization integration in a production build.

**Blocked by:** 04: Add Vue 3 template collection through native compiler adapters.

**Status:** ready-for-agent

## Context

The repository currently contains a Vue 2 demo and a React demo. Vue 3 support must be demonstrated through a real webpack module graph, not only direct extractor tests. The demo should be minimal and make loader order, resource-query handling, and project-local compiler selection easy to inspect.

Before implementation, read the repository agent instructions, demo conventions, collection architecture, existing Vue 2 webpack configuration, and existing formal output conventions.

## Decisions already made

- Create a separate Vue 3 demo rather than upgrading or replacing the Vue 2 demo.
- Use Webpack 5, Vue 3, vue-loader 17, `@vue/compiler-sfc`, and Vue I18n 9.
- Use the same collector package through workspace dependencies.
- Keep Vue 2 and React demos intact.
- Make the Vue 3 compiler resolvable from the demo's owning package.

## Acceptance criteria

- [ ] The Vue 3 demo has a production build that succeeds from the workspace.
- [ ] The webpack configuration applies collection to Vue template, script, and style block requests at the correct lifecycle position.
- [ ] The demo includes ordinary template text, static and dynamic user-facing attributes, interpolation strings, template-literal fragments, HTML directives, existing localization calls, script copy, and CSS generated content.
- [ ] The demo uses Vue I18n 9 through an already configured runtime integration; the collector does not install or rewrite bootstrap integration.
- [ ] The production build writes the expected dictionary, source map, keyed source catalog, and metadata through the existing plugin.
- [ ] An integration test or stable verification script proves that template copy came from original Vue 3 source ranges rather than generated render code.
- [ ] Existing Vue 2 and React demo behavior remains unchanged.

## Non-goals

- Do not use Vue CLI for this demo.
- Do not remove or upgrade the Vue 2 demo.
- Do not add Vite.
- Do not add template preprocessors.
- Do not make demo-specific exceptions in production extractor code.

## Validation

- Install workspace dependencies using the repository's established workflow.
- Run the Vue 3 production build.
- Inspect or test formal collection outputs.
- Run the Vue 2 and React demo builds to catch workspace dependency regressions.

