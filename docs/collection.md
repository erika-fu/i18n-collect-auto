# Collection troubleshooting

Vocabulary matches `CONTEXT.md`. The design record is `docs/collection-architecture.md`. Source replacement, translation providers, and the `translate`, `replace`, and `run` commands are documented in the README. This page is the collection troubleshooting record: the webpack round, the files that round publishes, and the failures that keep the previous output.

## Watch compiles again after a real collection change

`apps/demo/src/lang/index.js` imports the runtime dictionary:

```js
require(`/lang/${locale}_hash.json`)
```

Webpack resolves that to `apps/demo/lang/zh_hash.json`, so the dictionary and its parent `lang` directory are watched. `MyI18nPlugin` writes the official collection set after a successful compilation:

- `lang/zh_hash.json`, the hash dictionary. The key is the MD5 of the collected text.
- `lang/zh_hash.map.json`, the source map. Entries stay at schema version 1 and do not carry localization keys.
- `lang/catalog/<sourceLocale>.json`, the source-locale catalog. The default is `lang/catalog/zh.json`: a flat map from a localization key to source text.
- `lang/catalog/catalog.meta.json`, the catalog metadata (schema version 2): source text, source fingerprint, `explicit` or `derived` origin, source locations, and per-occurrence identity (stable ID, semantic host, child role, local context, origin). Version 1 metadata upgrades on read; unsupported or unreadable versions fail the round and leave formal outputs unchanged.

`catalogDir`, `sourceLocale`, and `catalogFormat` select those last two paths. `json` is the only format. `writeOutputs` compares each file's bytes with what would be written and leaves a file that already matches out of the commit. When every file matches, it returns before creating a journal or a temporary file. An unchanged collection therefore does not schedule another compilation.

A real change to any file in that set still writes the files whose bytes differ, as one commit. Watch then compiles once more so the bundle can import the new dictionary. A catalog-only write under `lang/catalog/` can schedule that same follow-up, because the watched directory is `lang`. The following compilation sees identical bytes, skips the write, and stays quiet. A real change adds at most that one follow-up compilation.

Changing a localization key without changing the text leaves the dictionary bytes the same and still rewrites the catalog and its metadata. That is enough to wake watch.

Regression: `packages/i18n-collect/test/watch-loop.test.js`. Catalog aggregation is `packages/i18n-collect/test/catalog.test.js`.

## A failed round keeps the previous output

A parse error, a malformed `i18n-key` directive, a localization key conflict, or an output error abandons the candidate round. The committed in-memory snapshots stay as they were. The dictionary, source map, source-locale catalog, and catalog metadata stay at the last successful bytes. The build fails. A loader error names the project-relative path, semantic block, style index and language when they apply, the 1-based line, and the 0-based UTF-16 column.

A key conflict is raised by the plugin after aggregation, not by the loader. The message starts with `i18n-collect failed:` and lists every conflicting text. The plugin abandons the round before `writeOutputs`, so a conflict does not publish a partial catalog.

The write itself is one commit. `writeOutputs` drops files that are already up to date, writes a `.commit-*.json` journal for the files that will change, then replaces those files. If the replacement fails, the journal restores that set, and `session.release` rolls the in-memory snapshots back to the checkpoint taken before the write. The next collection write looks for a leftover journal in each directory it is about to change and restores it before using those files as the new baseline. A journal that cannot be read or restored fails the round.

An unsupported style language is not a parse error. SCSS, Sass, Less, and Stylus produce one warning per resource identity, submit an empty snapshot, and do not fail the build. The warning code is `unsupported-style-preprocessor`. `apps/demo/fixtures/UnsupportedStyle.vue` is an isolated example and is not part of the demo entry.

Placing the loader after `thread-loader` fails the round. The pitch must run in the main process. The error is `i18n-collect loader must run in the main webpack process. Place it before thread-loader.`

## One production build can embed the previous dictionary

The application imports the dictionary, and the plugin can write the complete result only after loaders finish. The files written at the end of a one-shot production build are the latest collection, including the source-locale catalog. The bundle produced by that same compilation can still contain the dictionary from the start of the build. Watch is what pulls the new dictionary into a later compilation. This repository does not add a second compilation to close that loop. The demo bundle does not import the catalog.

## Nothing was collected

The plugin does not scan the project. A file is collected only when it enters `i18n-collect/myloader`. Collection normally happens in the loader pitch, which reads the resource file from disk. An `exclude` scope pattern removes that resource after `include`. A selected collection-context filter removes only the candidates in that policy; with `contextFilters: []`, logging, test, and analytics copy stays in the result. The call lists are in the README and in section 16.1 of `docs/collection-architecture.md`.

A build with no loader invocation and no restored loader metadata fails and asks for the ordinary module rules, the Vue script, template, and style rules, and the HTML template loader chain. An empty snapshot, an excluded file, and an unsupported style are still loader evidence. Restored module metadata from the webpack filesystem cache is also loader evidence. Metadata from another root compiler, another configuration hash, or an unsupported schema stays out of the session and fails the round, so a foreign snapshot is not published.

The hash stored on the module is `fileConfigHash`. It covers the collection fields in `i18n-collect.config.js` and ignores `catalogDir`, `sourceLocale`, `catalogFormat`, `translationProvider`, `targetLocales`, and `translationFailure`. Changing only those fields does not by itself invalidate cached snapshots, and it does not change the source map's `configHash`. The catalog is still written to the configured directory, because the plugin reads the full config when the round succeeds.

`i18n-collect collect` runs this same integration once. It reads `webpack.config.js` unless `--webpack-config` is set. `--include`, `--exclude`, and `--context-filter` replace those three fields for that run; repeating a flag sets several values. The webpack bundle is emitted outside the project. The command does not translate and does not make network requests. Exit 0 means the report was printed. Exit 1 is a configuration failure. Exit 2 is a collection failure: a malformed key directive, a key conflict, a missing loader, or the thread-loader placement above. Exit 3 is some other build failure. A collection failure keeps the previous dictionary, source map, and catalog.

The human report counts dictionary entries and lists the catalog files plus how many localization keys were added, removed, source-changed, or unchanged against the metadata from before the run. `--json` prints that report as JSON. The Vue demo is wired through Vue CLI, so its checked-in dictionary still comes from `npm run update-demo-collection`.

## A comment removed one fragment

An exclusion directive is a syntax-valid comment whose text is exactly `no-i18n-auto`. It removes the next collected fragment of the construct it immediately precedes: a script string or template literal, a Vue or static HTML element or text node, or a CSS `content` declaration or string. Ordinary comments are not collected and do not exclude copy. The association rules are in the README and in section 12.1 of `docs/collection-architecture.md`. Kept fragments keep their source coordinates. A parse error still fails the round and keeps the previous output.

An `i18n-key` comment in the same whitespace-separated group names that fragment. It does not remove it. Exclusion still requires `no-i18n-auto`. When the fragment is excluded, the key in that group has no effect. A comment that starts with `i18n-key` but is not `i18n-key: <key>` fails in the loader instead of excluding anything.

## A localization key conflict failed the round

A key conflict means one localization key names two different source texts. The same `i18n-key: home.title` on `"首页"` in one file and `"主页"` in another is a conflict. An explicit key that equals another text's automatic key is also a conflict. The error lists each text with its origin (`explicit` or `derived`) and every `path:line:column (kind)` location. Give each text its own key, or make the texts agree. The round keeps the previous dictionary, source map, and catalog.

A location without an explicit key gets an automatic key. On first sighting the key is derived from the project-relative path, the semantic kind, the text, and that occurrence's source range. Later rounds reuse that key when `catalog.meta.json` uniquely matches the occurrence by structural anchors, using source text only as auxiliary evidence when sibling counts change; unmatched occurrences get a new key. Identical text at separate locations therefore receives independent catalog keys and metadata records. The legacy MD5 dictionary and source map still deduplicate by text value; they are not the localization-key identity.

A malformed key directive fails in the loader instead. The message names the path, block, line, and column of the comment. Use `i18n-key: <key>`, where the key starts with a letter and uses dot-separated segments of letters, digits, `_`, and `-`. Two different keys in one directive group for the same fragment fail the same way.

## The dictionary stayed the same and the catalog changed

The dictionary is keyed by the MD5 of the text. The catalog is keyed by the localization key. These can move separately:

- Editing only an `i18n-key` comment changes the catalog and the metadata. The dictionary bytes stay the same when the text is unchanged.
- A source-text change changes the dictionary entry, the catalog value, and the metadata fingerprint. Collection does not rewrite target-locale catalogs or review state. A later `translate` keeps the existing target text and marks it `needs-review`. That command is documented in the README.
- Removing the last location of a text drops it from the dictionary and drops its key from the source-locale catalog. Collection does not delete that key from an existing target-locale catalog.

`collect` reports this split in the catalog section: `added`, `removed`, `changed`, and `unchanged` compare fingerprints in `catalog.meta.json`, not MD5 keys in the dictionary.

## Coordinates do not match the decoded text

Source coordinates are 1-based lines and 0-based UTF-16 columns. Ranges are half-open. HTML entity and CSS escape values are decoded for the dictionary and for the catalog, while the source range still covers the original spelling and excludes HTML or CSS string delimiters. Historical JavaScript ranges still include the JavaScript string delimiters. A column after an astral character counts that character as two UTF-16 code units. CRLF is one line break. An explicit localization key does not move the range.
