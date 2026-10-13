# i18n-collect

This repository collects Chinese user-facing copy during a webpack 5 build. It contains Vue 2 and React demos alongside the `i18n-collect` package. Collection does not rewrite application source.

- `packages/i18n-collect` exports `myloader` and `myplugin`.
- `apps/demo` is the Vue 2 / Vue CLI demo. It uses vue-loader 15 and vue-i18n 8.
- `apps/react-demo` is the React / standalone Webpack 5 demo.

The loader owns collection. The plugin owns the collection session, aggregation, and output. The plugin does not read business source and does not scan the project. A resource that never enters the loader is absent from the result. A failed round does not publish a partial result.

## Setup

```
npm install
```

### Development and production

```
npm run serve
npm run build
npm run build-react-demo
```

`npm test` runs the package tests. Those tests use temporary directories and do not rewrite either demo's `lang` directory.

Refresh checked-in dictionaries and source maps with the appropriate production build:

```
npm run update-demo-collection
npm run update-react-demo-collection
```

The first command runs `vue-cli-service build` for the Vue demo; the second runs the React demo's Webpack production build. These are the only workflows that update their respective committed collection files.

## Webpack 5 integration

The package peer dependency is webpack 5. Webpack 4, Vite, and Rollup are not supported.

`apps/demo/vue.config.js` and `apps/react-demo/webpack.config.js` show the supported integration shapes:

- Instantiate the collector plugin exactly once per compiler.
- Place the collector before later script transforms, so its pitch runs in the main process and reads original source. The Vue demo places it before `thread-loader`; the React demo places it before Babel.
- Vue `type=template`, `type=script`, and `type=style` queries each run the collector where applicable.
- Put the collector at the right-most end of a plain CSS `use` array, so it receives raw CSS before `css-loader` processing.
- Use an explicit HTMLWebpackPlugin template request. See below.

The React demo exercises JavaScript string and template-literal extraction in `.jsx` modules. JSX text-child and JSX-attribute collection semantics are not documented as supported. Loader order is enforced by final webpack configuration tests in `packages/i18n-collect/test/loader-order.test.js`.

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

## Exclusion directive

A comment is an exclusion directive when it is syntax-valid in that source and its text, ignoring surrounding whitespace, is exactly `no-i18n-auto`. The match is case-sensitive. Extra words, a different spelling, or different casing leave the comment irrelevant. The directive is control metadata and is never collected. Ordinary comments, including comments that contain Chinese, are not collected and do not exclude anything.

The directive associates with the collectable construct that starts after it when only whitespace separates them. It removes exactly one collected fragment: the next fragment of that construct. Later fragments of the same construct, and every neighboring construct, stay in the result. A comment after a construct does not apply backward. Source coordinates of kept fragments, resource snapshots, and failed-round behavior stay the same.

Script:

- A string literal is the construct. The directive removes that string.
- A template literal is the construct. The directive removes only the first static fragment of that literal that contains Chinese.
- A comment with code between it and the literal, such as `// no-i18n-auto` on the line above `const label = "文案"`, does not associate. Place the comment immediately before the literal.

Vue template and static HTML:

- An element is the construct. The directive removes the earliest collected fragment owned by that element, in source order. An allowlisted attribute comes before the element's text. The first interpolation fragment comes before a later one.
- A text node is the construct when the comment sits immediately before that text, as in `前文<!-- no-i18n-auto -->后文`. The directive removes the first collected fragment of that text node.
- Whitespace between the comment and the next element does not break the association. A comment that immediately precedes an element with no collected fragment does not move on to the next element.
- A JavaScript comment inside an interpolation or a dynamic attribute uses the script rules for that expression.

CSS:

- A `content` declaration is the construct when the comment is the previous node and only whitespace separates them. The directive removes the first collected string in that declaration.
- A string inside a `content` value is the construct when a comment sits immediately before that string. The directive removes that string only.
- A comment before a rule does not exclude the strings inside the rule.

Two directives that select the same fragment remove it once. They do not also remove the following fragment.

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
- Source rewriting, final-bundle scanning, webpack 4, Vite, Rollup, and evaluating dynamic expressions are not supported.

Source coordinates are 1-based lines and 0-based UTF-16 columns. Ranges are half-open.
