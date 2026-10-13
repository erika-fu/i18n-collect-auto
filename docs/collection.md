# Collection troubleshooting

Vocabulary matches `CONTEXT.md`. The design record is `docs/collection-architecture.md`.

## Watch compiles again after a real collection change

`apps/demo/src/lang/index.js` imports the runtime dictionary:

```js
require(`/lang/${locale}_hash.json`)
```

Webpack resolves that to `apps/demo/lang/zh_hash.json`, so the dictionary and its parent directory are watched. `MyI18nPlugin` writes both official outputs after a successful compilation.

`writeOutputs` compares bytes first. When both files already contain the bytes that would be written, it returns before creating a temporary file. An unchanged collection therefore does not schedule another compilation.

A real dictionary change still writes. Watch then compiles once more so the bundle can import the new dictionary. The following compilation sees identical bytes, skips the write, and stays quiet. A real change adds at most that one follow-up compilation.

Regression: `packages/i18n-collect/test/watch-loop.test.js`.

## A failed round keeps the previous output

A parse error or an output error abandons the candidate round. The committed in-memory snapshots stay as they were, and both official files stay at the last successful bytes. The build fails. The error names the project-relative path, semantic block, style index and language when they apply, the 1-based line, and the 0-based UTF-16 column.

An unsupported style language is not a parse error. SCSS, Sass, Less, and Stylus produce one warning per resource identity, submit an empty snapshot, and do not fail the build. `apps/demo/fixtures/UnsupportedStyle.vue` is an isolated example and is not part of the demo entry.

## One production build can embed the previous dictionary

The application imports the dictionary, and the plugin can write the complete result only after loaders finish. The files written at the end of a one-shot production build are the latest collection. The bundle produced by that same compilation can still contain the dictionary from the start of the build. Watch is what pulls the new file into a later compilation. This repository does not add a second compilation to close that loop.

## Nothing was collected

The plugin does not scan the project. A file is collected only when it enters `i18n-collect/myloader`. An `exclude` scope pattern removes that resource after `include`. A selected collection-context filter removes only the candidates in that policy; with `contextFilters: []`, logging, test, and analytics copy stays in the result.

A build with no loader invocation and no restored loader metadata fails and asks for the ordinary module rules, the Vue script, template, and style rules, and the HTML template loader chain. An empty snapshot, an excluded file, and an unsupported style are still loader evidence. Restored module metadata from the webpack filesystem cache is also loader evidence. Metadata from another root compiler or another configuration hash stays out of the session and fails the round, so a foreign snapshot is not published.

## A comment removed one fragment

An exclusion directive is a syntax-valid comment whose text is exactly `no-i18n-auto`. It removes the next collected fragment of the construct it immediately precedes: a script string or template literal, a Vue or static HTML element or text node, or a CSS `content` declaration or string. Ordinary comments are not collected and do not exclude copy. The association rules are in the README. Kept fragments keep their source coordinates. A parse error still fails the round and keeps the previous output.

## A localization key conflict failed the round

A key conflict means one localization key names two different source texts, for example the same `i18n-key: home.title` on `"首页"` in one file and `"主页"` in another. The error lists each text with its origin and every `path:line:column (kind)` location. Give each text its own key, or make the texts agree. The round keeps the previous dictionary, source map, and catalog.

A malformed key directive fails in the loader instead. The message names the path, block, line, and column of the comment. Use `i18n-key: <key>`, where the key starts with a letter and uses dot-separated segments of letters, digits, `_`, and `-`.

## Coordinates do not match the decoded text

Source coordinates are 1-based lines and 0-based UTF-16 columns. Ranges are half-open. HTML entity and CSS escape values are decoded for the dictionary, while the source range still covers the original spelling and excludes HTML or CSS string delimiters. Historical JavaScript ranges still include the JavaScript string delimiters. A column after an astral character counts that character as two UTF-16 code units. CRLF is one line break.
