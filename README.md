# i18n-collect

This repository collects Chinese user-facing copy during a webpack 5 build. It is a Vue CLI demo plus the `i18n-collect` package. Collection does not rewrite application source.

- `packages/i18n-collect` exports `myloader` and `myplugin`.
- `apps/demo` is the Vue 2 demo. It uses vue-loader 15 and vue-i18n 8.

The loader owns collection. The plugin owns the collection session, aggregation, and output. The plugin does not read business source and does not scan the project. A resource that never enters the loader is absent from the result. A failed round does not publish a partial result.

## Setup

```
npm install
```

### Development and production

```
npm run serve
npm run build
```

`npm test` runs the package tests. Those tests use temporary directories and do not rewrite `apps/demo/lang`.

Refresh the checked-in demo dictionary and source map with the production build:

```
npm run update-demo-collection
```

That command is `vue-cli-service build` for the demo. It is the only workflow that updates the committed collection files.

## Webpack 5 integration

The package peer dependency is webpack 5. Webpack 4, Vite, and Rollup are not supported.

`apps/demo/vue.config.js` is the integration used by the demo:

- The collector is placed before `thread-loader` on script rules, so its pitch runs in the main process and reads the original file.
- Vue `type=template`, `type=script`, and `type=style` queries each run the collector.
- Standalone CSS runs the collector before `postcss-loader` and `css-loader`.
- The HTMLWebpackPlugin template request is explicit. See below.

Loader order is enforced by the final webpack configuration and covered by `packages/i18n-collect/test/loader-order.test.js`.

## What is collected

| Source | Semantic kind |
| --- | --- |
| JavaScript string | `script-string` |
| JavaScript template-literal segment | `template-literal` |
| Vue template text | `html-text` |
| Vue allowlisted attribute, including a static fragment of a dynamic binding | `html-attribute` |
| Static fragment inside a Vue interpolation | `template-expression` |
| Standalone HTML text | `static-html-text` |
| Standalone HTML allowlisted attribute | `static-html-attribute` |
| Static string in a CSS `content` declaration | `css-generated-content` |

A fragment is collected when it contains a Han character. The collected value keeps the rest of that static fragment. Import and export specifiers, non-allowlisted attributes, CSS comments, custom properties, and `content` values of `none`, `normal`, empty text, or whitespace are ignored.

The demo pages show script strings, template literals, Vue interpolation, Vue text, allowlisted static and dynamic attributes, Vue CSS generated content, and standalone CSS. `public/index.html` is the standalone HTML document. `apps/demo/fixtures/UnsupportedStyle.vue` is the unsupported preprocessor example and is not imported by the app.

## Configuration

One `i18n-collect.config.js` at the project root supplies the defaults below. Loader options may set `include`, `exclude`, `attributeAllowlist`, and `styleExtensions`. Plugin options may set `outputPath` and `sourceMapFilename`. A field passed to the wrong side is an error. Unknown fields are errors. `htmlEntries` is not a field.

```js
{
  styleExtensions: ['.css'],
  include: [],
  exclude: [],
  attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label', 'value'],
  outputPath: 'lang/zh_hash.json',
  sourceMapFilename: 'lang/zh_hash.map.json'
}
```

`include` and `exclude` are project-relative file or directory prefixes, not globs. An empty `include` allows every resource that enters the loader. `exclude` then vetoes matches. The plugin does not apply these filters again.

## Output

The runtime dictionary is `{ "<md5>": "<value>" }`. The source map stays at `version: 1` and uses the semantic kinds above. `parserVersion` remains `"babel-7"` as a historical JavaScript parser marker. Keys, entries, and locations are sorted; locations are ordered by path, kind, and numeric line and column. Identical bytes are not written. The two files are written as a pair and restored together if the write fails.

## HTMLWebpackPlugin

The demo template contains `<%= BASE_URL %>` and `<%= htmlWebpackPlugin.options.title %>`. A normal `.html` rule is not enough, because HTMLWebpackPlugin compiles that template with its own loader. The demo forces this request, with loaders running from right to left:

```text
html-webpack-plugin/lib/loader.js?force=true
  ! i18n-collect/myloader
  ! public/index.html
```

`force=true` is required. Without it, HTMLWebpackPlugin's loader can skip itself when another loader is present and leave the EJS markers in the page. The collector therefore sees the original template, and HTMLWebpackPlugin still expands the markers and injects assets.

## Resource identity

A resource identity is the project-relative path, using `/`, plus the semantic block:

```text
src/utils/message.js::script
public/index.html::html
src/App.vue::script[lang=js]
src/App.vue::template[lang=html]
src/App.vue::style[index=0;lang=css]
```

Each loader call submits a complete replacement snapshot for that identity, including an empty snapshot. A later round drops text that is no longer in the snapshot. Distinct blocks from the same file do not overwrite each other. Removed imports, deleted files, deleted blocks, and filter changes drop snapshots that are no longer in the live set.

## Limits

- SCSS, Sass, Less, and Stylus are warning and skip only. There is no parser for them.
- A parse error fails the round and keeps the previous official output.
- Watch may compile one extra time after a real dictionary change, then become quiet.
- A one-shot production build writes the latest dictionary, but that same bundle can still embed the previous dictionary.
- Source rewriting, final-bundle scanning, webpack 4, Vite, Rollup, evaluating dynamic expressions, and `no-i18n-auto` are not supported.

Source coordinates are 1-based lines and 0-based UTF-16 columns. Ranges are half-open.
