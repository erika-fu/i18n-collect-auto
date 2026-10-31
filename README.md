# i18n-collect

This repository collects Chinese user-facing copy during a webpack 5 build and can carry that copy into a keyed translation catalog and into source replacement. It contains Vue 2 and React demos alongside the `i18n-collect` package. Collection does not rewrite application source. Source replacement is a separate command and stays a replacement preview unless `--write` is set.

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

`npm test` runs the package tests, including the migration workflow against `packages/i18n-collect/fixtures/replacement`. Those tests use temporary directories and a local fake translation provider. They do not rewrite either demo's `lang` directory, and they do not need an API key, a vendor SDK, or an outbound network request.

Refresh checked-in dictionaries and source maps with the appropriate production build:

```
npm run update-demo-collection
npm run update-react-demo-collection
```

The first command runs `vue-cli-service build` for the Vue demo; the second runs the React demo's Webpack production build. These are the only workflows that update their respective committed collection files.

## Collection command

`i18n-collect collect` runs that same webpack integration once, without a prompt. The configuration must already include `i18n-collect/myloader` and `i18n-collect/myplugin`. The command reads `i18n-collect.config.js` and can replace `include`, `exclude`, and `contextFilters` with `--include`, `--exclude`, and `--context-filter`. It writes the hash dictionary, the source map, and the keyed translation catalog, prints a collection report, and leaves application source unchanged. It does not translate or make network requests. The webpack bundle is emitted outside the project.

The report's `catalog` section names the catalog and metadata files and lists the localization keys that were added, removed, source-changed, or unchanged compared with the metadata present before the run. The human report prints the counts.

```
npx i18n-collect collect --webpack-config webpack.config.js
npx i18n-collect collect --json
npx i18n-collect collect --help
```

Exit 0 means collection finished. Exit 1 is a configuration failure, exit 2 is a collection failure, and exit 3 is a build failure. A malformed `i18n-key` directive and a localization key conflict are collection failures. A collection failure keeps the previous dictionary, source map, and catalog. The Vue demo is wired through Vue CLI, so its checked-in dictionary still comes from `npm run update-demo-collection`.

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

Directive comments that are separated only by whitespace form one group in front of the construct, so `/* no-i18n-auto */ /* i18n-key: a.b */ "文案"` applies both directives to `"文案"`. An ordinary comment or code between two directives ends the group.

## Localization keys

Every collected location receives a localization key. The keyed translation catalog is the shared boundary for translation and source replacement; the hash dictionary stays alongside it during the migration.

An explicit key comes from an `i18n-key` directive: a syntax-valid comment whose text is `i18n-key: <key>`. The key starts with a letter and is made of dot-separated segments of letters, digits, `_`, and `-`, such as `home.title` or `order.list-empty`. The directive associates with the same fragment that `no-i18n-auto` would remove in that position, using the rules above for script, Vue template, static HTML, and CSS. A comment whose text starts with `i18n-key` but does not have that shape is a malformed directive. It fails the round at the comment's position. A directive group that names two different keys for one fragment also fails. When a fragment is excluded, its key directive has no effect.

```js
const title = /* i18n-key: home.title */ '首页'
```

```html
<!-- i18n-key: home.welcome -->
<p>欢迎使用</p>
```

A location without an explicit key gets an automatic key. It is built from the project-relative path without its extension, written as dot-separated segments with other characters replaced by `_` and a `k` prefix when the path does not start with a letter, plus 8 hex characters of a SHA-256 hash over the path, the semantic kind, the collected text, and that occurrence's source range. For example, `欢迎` in Vue template text of `src/pages/Home.vue` gets `src.pages.Home.<hash>`. Identical text at separate locations receives independent catalog keys so each occurrence can take a different translation. The legacy MD5 dictionary and source map still deduplicate by text value.

An explicit key may intentionally gather several locations when they all name the same source text. A key that names two different source texts is a key conflict. An explicit key that equals another text's automatic key is also a conflict. A conflict fails the round, keeps every previous output, and lists each conflicting text with all of its locations.

## Translation catalog

After each successful round the plugin writes two catalog files in the same transaction as the hash dictionary and source map:

- `<catalogDir>/<sourceLocale>.json`: the source-locale catalog, a flat `{ "<localization key>": "<source text>" }` mapping with sorted keys.
- `<catalogDir>/catalog.meta.json`: catalog metadata, `{ version: 1, sourceLocale, format, entries }`. Each entry records the source text, a `fingerprint` (the first 16 hex characters of the SHA-256 of the source text), its `origin` (`explicit` or `derived`), and its sorted source locations.

Comparing two metadata files tells which keys were added, removed, or source-changed: a key that remains with a different fingerprint has changed source text. Target-locale catalogs are not written by collection.

The catalog's external representation goes through a format adapter. An adapter has a `name`, a file `extension`, `serialize(messages)` that returns identical text for identical messages, and `parse(text)`. `json` is the only adapter and the default.

## Translation command

`i18n-collect translate` fills target-locale catalogs from a project translation provider. It reads the source-locale catalog and catalog metadata written by collection. It does not run webpack, does not rewrite application source, and does not ship a vendor SDK. The provider is a local project module, so a fake provider needs no credentials and no network access.

```
npx i18n-collect translate
npx i18n-collect translate --locale en --provider i18n/provider.js
npx i18n-collect translate --retranslate --failure strict --json
npx i18n-collect translate --allow-network
npx i18n-collect translate --help
```

Configuration fields, all optional for collection:

- `translationProvider`: a project-relative module path. The module exports `translate(request)` or is that function.
- `targetLocales`: locale tags to fill, such as `['en']`. A tag must not equal `sourceLocale`.
- `translationFailure`: `partial` (the default) or `strict`.

`--provider`, `--locale`, and `--failure` replace those fields for one run. Repeat `--locale` to set several tags. These fields are not loader or plugin options, and they do not change the source map's `configHash`.

The provider request is:

```js
{
  sourceLocale: 'zh',
  locales: ['en'],
  items: [{ key: 'home.title', source: '首页', locales: ['en'] }]
}
```

`locales` is every target locale requested for the run. Each item is one source text selected for a draft, and `item.locales` is the subset still needed for that key. Return:

```js
{
  drafts: [{ key: 'home.title', locale: 'en', text: 'Home' }],
  failures: [{ key: 'home.body', locale: 'en', message: 'glossary rejected 正文' }]
}
```

A failure for a pair suppresses a draft for that same pair. A requested pair with neither a draft nor a failure fails as `provider returned no draft`. Draft text must be a string. Drafts for pairs that were not requested are ignored.

Set `network: true` on the exported function, or on the module object beside `translate`, when the provider can send source text outside the project. `translate` is not called with that source text until the run is authorized. An interactive terminal asks `Allow this network translation? [y/N]`. A non-interactive or CI run does not read a piped answer; pass `--allow-network`. Without authorization the command exits 5, writes nothing, and reports `authorization`. A local provider omits `network`, so tests can use a fake provider with no credentials and no outbound network traffic. A run that selects no source text does not ask and does not call the provider.

Selection rules:

- A target entry that has no text is always sent to the provider. A successful draft creates it and records the current source fingerprint with review `current`.
- An existing translation is kept, and the provider is not asked for it, unless `--retranslate` is set.
- `--retranslate` also sends every existing translation. A successful draft replaces the text, records the current source fingerprint, and sets review to `current`.
- The first time an existing translation is seen, with no review record, it is accepted as the translation of the current source: the text stays, and the current fingerprint is recorded with review `current`.
- An existing translation whose recorded source fingerprint differs from the current source fingerprint keeps its text and is marked `needs-review`. It is not sent to the provider unless `--retranslate` is set. A failed retranslate leaves the previous text and the `needs-review` mark. When the current source fingerprint matches the recorded fingerprint again, review returns to `current` and the text stays.
- A key that is present, including one whose text is an empty string, is an existing translation. Only a missing key is sent to the provider by default.

`partial` writes every successful draft and review mark, leaves failed pairs unchanged, and exits 4 with a report that names each failed key, locale, and message. A run that accepts nothing does not create a new target catalog or review file. `strict` writes nothing when any pair fails, including review marks from that run, and the report lists withheld drafts. Exit 0 means every selected pair succeeded. Exit 1 is a configuration failure. Exit 4 is a provider or item failure. Exit 5 is denied network authorization. Exit 6 is a storage failure. The JSON report for an item failure includes `policy` and `failures`. Authorization and storage failures use `failure` of `authorization` or `storage` and do not report a partial write.

Translate prepares every target catalog and the review state that this run will change, writes a journal for that set, then replaces the files. The journal is removed only after every replacement. If a replacement fails, or the process exits while the journal is still there, the previous files are restored and a caught failure exits 6 with `storage`. The next `translate` restores a journal it still finds before it reads catalogs, and exits 6 if that journal cannot be read or restored. Backup files are removed after the commit; a failure to delete one does not undo the catalogs. An item failure under `partial` or `strict` is not a storage failure: `partial` still keeps successful drafts, and `strict` still leaves the catalogs untouched.

Translate writes:

- `<catalogDir>/<locale>.json`: the target catalog, through the same format adapter as the source catalog. Keys that are not in the source catalog are left in place.
- `<catalogDir>/translation-state.json`: review state, `{ version: 1, locales }`. Each locale maps a localization key to `{ sourceFingerprint, review }`. `review` is `current` or `needs-review`. The recorded fingerprint stays at the source the translation was accepted against, so a later source change can be told apart from the current catalog metadata.

The demo pages show script strings, template literals, Vue interpolation, Vue text, allowlisted static and dynamic attributes, Vue CSS generated content, and standalone CSS. `public/index.html` is the standalone HTML document. `apps/demo/fixtures/UnsupportedStyle.vue` is the unsupported preprocessor example and is not imported by the app.

## Migration outputs

Migration keeps the following distinct:

| Name | What it is |
| --- | --- |
| Collected text | Chinese copy found in source. Collection records it and leaves the file unchanged. |
| Hash collection output | `lang/zh_hash.json` and `lang/zh_hash.map.json`. The dictionary key is the MD5 of the collected text. |
| Translation catalog | `lang/catalog/<locale>.json`, a flat map from a localization key to text. Collection writes the source locale. Translate writes each target locale. |
| Catalog metadata | `lang/catalog/catalog.meta.json`: source text, source fingerprint, origin, and source locations. |
| Review state | `lang/catalog/translation-state.json`: for each key and target locale, the source fingerprint the translation was accepted against, and `current` or `needs-review`. |
| Translation provider | A project module passed to translate. It is not an output file and it is not a vendor SDK. |
| Replacement preview | The default result of replace. It reports the source that would be written and does not modify files. |
| Source replacement | The rewrite of a supported location into a runtime localization call. Source files change only with `--write`. |
| Replacement metadata | `lang/catalog/replacements.json`, the record of committed replacements. A write commits source files, the keyed catalogs, and this record together. |

The hash collection output stays so existing hash consumers keep working. Translation and source replacement use the translation catalog.

## Source replacement

`i18n-collect replace` turns supported collected locations into runtime localization calls backed by the translation catalog. The default is a replacement preview. That dry-run does not write source files, catalogs, or replacement metadata. It does not install dependencies, and it does not rewrite application bootstrap.

```
npx i18n-collect replace --adapter js
npx i18n-collect replace --adapter vue2 --json
npx i18n-collect replace --adapter vue3 --strict
npx i18n-collect replace --adapter js --write
```

`--adapter` is required:

- `vue2` rewrites Vue 2 template text to `{{ $t('key') }}`, a static allowlisted attribute to `:name="$t('key')"`, a template expression or dynamic attribute string to `$t('key')`, and a string in an Options API instance method to `this.$t('key')`. It requires vue-i18n 8 and an existing `Vue.use(VueI18n)` or `new VueI18n(...)` call.
- `vue3` uses those same template calls. `<script setup>` uses `t('key')` where `t` is already in scope. Options API instance methods use `this.$t('key')`. It requires vue-i18n 9 or newer and an existing `createI18n(...)` call.
- `js` rewrites a supported JavaScript or TypeScript string or template literal to `t('key')` where `t` is already in scope. It requires an existing module that exports a function named `t`. The command does not insert an import.

Supported script positions are variable initializers, assignments, returns, throws, call and constructor arguments, array elements, object values, conditionals, logical and binary operands, sequence expressions, expression statements, arrow function bodies, default exports, and template literals in those positions.

React JSX, standalone HTML, and CSS generated content are outside replacement scope. Object keys, switch cases, and other unsupported positions are skipped with a source location and a reason. An already localized `t()`, `$t()`, or `this.$t()` call is recognized and left unchanged, so a repeated run does not nest it. `--strict` turns every skipped candidate into failure and writes nothing. Already localized calls are not skipped.

`--write` prepares every changed source file, the keyed catalogs, and replacement metadata, then commits that set together. If the commit fails, those files are restored to their previous content. The next replace restores a journal it still finds before it plans another write. Exit 0 means the preview or the write finished. Exit 1 is a configuration failure, including a missing runtime integration. Exit 6 means the replacement files could not be saved. Exit 7 means strict mode found a skipped candidate.

These fixtures show the supported adapters:

- `packages/i18n-collect/fixtures/replacement/vue2` is the Vue 2 example: template text, an allowlisted attribute, and an Options API instance method, with vue-i18n 8 already integrated.
- `packages/i18n-collect/fixtures/replacement/vue3` is the Vue 3 example: template text and a `<script setup>` binding, with `createI18n` and an exported `t` already present.
- `packages/i18n-collect/fixtures/replacement/js` is the generic JavaScript example. It also shows an exclusion directive, an `i18n-key` directive, an exclude glob that vetoes `src/legacy/**/*.js`, and a local translation provider. That provider does not set `network`, so a test can call it with no API key and no outbound request.

## Workflow command

`i18n-collect run` composes collection, translation, and source replacement. Selected stages always run in this order: collect, then translate, then replace. A failing stage stops the workflow and keeps that stage's exit code and diagnostic. Replacement stays a replacement preview unless `--write` is set. `--allow-network` and `--strict` mean the same thing here as they do on `translate` and `replace`.

```
npx i18n-collect run --collect
npx i18n-collect run --collect --translate
npx i18n-collect run --collect --replace --adapter js
npx i18n-collect run --collect --translate --replace --adapter js --write
```

Exit codes are the exit code of the stage that finished the workflow: 0 finished, 1 configuration, 2 collection, 3 build, 4 translation, 5 network translation was not authorized, 6 storage, and 7 strict mode.

## Configuration

One `i18n-collect.config.js` at the project root supplies the defaults below. Loader options may set `include`, `exclude`, `contextFilters`, `attributeAllowlist`, and `styleExtensions`. Plugin options may set `outputPath`, `sourceMapFilename`, `catalogDir`, `sourceLocale`, and `catalogFormat`. A field passed to the wrong side is an error. Unknown fields are errors. `htmlEntries` is not a field.

```js
{
  styleExtensions: ['.css'],
  include: [],
  exclude: [],
  contextFilters: [],
  attributeAllowlist: ['title', 'placeholder', 'alt', 'aria-label', 'value'],
  outputPath: 'lang/zh_hash.json',
  sourceMapFilename: 'lang/zh_hash.map.json',
  catalogDir: 'lang/catalog',
  sourceLocale: 'zh',
  catalogFormat: 'json',
  translationProvider: '',
  targetLocales: [],
  translationFailure: 'partial'
}
```

`catalogDir` is a project-relative directory. `sourceLocale` is a locale tag such as `zh` or `zh-CN` and names the source-locale catalog file. `catalogFormat` names the format adapter. The catalog files must not coincide with `outputPath` or `sourceMapFilename`. The catalog fields and the translation fields do not take part in the source map's `configHash`.

`translationProvider` is a project-relative path and may be empty. `targetLocales` lists locale tags other than `sourceLocale`, with no duplicates. `translationFailure` is `partial` or `strict`. See Translation command for how they are used.

`include` and `exclude` are project-relative scope patterns. A pattern with no `*`, `?`, `[`, or `{` is a file or directory boundary: `src/foo` matches `src/foo` and `src/foo/bar.js`, and does not match `src/foobar.js`. A pattern with those characters is a glob. `*` and `?` stay inside one path segment. `**` matches any number of segments, including zero, and must be a whole segment. `[abc]`, `[a-z]`, `[!abc]`, and `[^abc]` match one character in that segment; a `]` placed first in the class is literal. Backslash is a separator, not an escape. An empty `include` allows every resource that enters the loader. `exclude` then vetoes a match, whether the overlapping rules are boundaries, globs, or one of each. The plugin does not apply these filters again.

These patterns are configuration errors: an absolute path, a pattern that leaves the project root, an empty pattern or the project root itself, a duplicate after normalization, a glob that ends with `/`, brace expansion, `**` glued to other characters, `..` after a glob segment, or an unclosed, empty, or stray character class. A `..` segment before any glob is normalized, so `src/../kept/**/*.js` is `kept/**/*.js`.

`contextFilters` lists optional policies for candidates a project does not treat as user-facing copy. The allowed names are `logging`, `tests`, and `analytics`. The default `[]` selects none of them. Collection does not drop text by guessing; a category is omitted only after the configuration selects it. Each name can be selected on its own. Unknown names and duplicates are configuration errors. This field belongs to the loader.

The policies are:

- `logging` omits a script string or template literal when the nearest call is `console.log`, `console.info`, `console.warn`, `console.error`, `console.debug`, `console.trace`, `log`, or `logger` with those same method names, and the literal is inside that call's arguments. `console.log(format("界面"))` keeps `界面`, because the nearest call is `format`.
- `tests` omits a candidate that sits lexically inside `describe`, `it`, `test`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `expect`, or the `.only`, `.skip`, `.each`, and `.todo` forms of `describe`, `it`, and `test`. A string in the same file, outside those calls, stays. This filter does not exclude a test file; use an `exclude` glob for that.
- `analytics` omits a candidate when the nearest call is `gtag`, `track`, `analytics.track`, `analytics.page`, `analytics.identify`, `analytics.screen`, or `dataLayer.push`, and the literal is inside that call's arguments, including a string property of an object argument.

These filters apply to script and to script expressions in Vue interpolations and dynamic attributes. They do not remove HTML text or CSS generated content. A callee written with a computed property, optional call, or tagged template is not one of these calls, so its text stays.

## Output

The runtime dictionary is `{ "<md5>": "<value>" }`. The source map stays at `version: 1` and uses the semantic kinds above. `parserVersion` remains `"babel-7"` as a historical JavaScript parser marker. Keys, entries, and locations are sorted; locations are ordered by path, kind, and numeric line and column. Localization keys do not change either file. Identical bytes are not written. The dictionary, source map, and catalog files are written as one set and restored together if the write fails.

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
- A parse error, a malformed `i18n-key` directive, or a localization key conflict fails the round and keeps the previous official output.
- A key directive that does not associate with a collected fragment is ignored, like an unattached `no-i18n-auto`.
- Watch may compile one extra time after a real dictionary change, then become quiet.
- A one-shot production build writes the latest dictionary, but that same bundle can still embed the previous dictionary.
- Final-bundle scanning, webpack 4, Vite, Rollup, and evaluating dynamic expressions are not supported.
- Source replacement covers only the positions named by the `vue2`, `vue3`, and `js` replacement adapters. React JSX, standalone HTML, and CSS generated content stay outside replacement scope. Collection still records standalone HTML, CSS generated content, and JavaScript strings inside a JSX module.

Source coordinates are 1-based lines and 0-based UTF-16 columns. Ranges are half-open.
