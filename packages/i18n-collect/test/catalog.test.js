const assert = require('assert')
const test = require('node:test')
const { automaticKey, buildCatalog, catalogMetadata, conflictMessage, diffCatalog, upgradeCatalogMetadata } = require('../mycommon/catalog')
const { catalogFormat } = require('../mycommon/catalog-format')
const { isLocalizationKey } = require('../myloader/directives')

function at(path, kind, line, column, length = 2) {
  return { path, kind, start: { line, column }, end: { line, column: column + length } }
}

function snapshot(identity, entries) {
  return { identity, projectPath: identity.split('::')[0], entries }
}

test('catalog metadata records a stable occurrence identity apart from source text and coordinates', () => {
  const first = at('src/a.js', 'script-string', 1, 0)
  const second = at('src/a.js', 'script-string', 3, 4)
  const movedFirst = at('src/a.js', 'script-string', 8, 0)
  const movedSecond = at('src/a.js', 'script-string', 12, 4)
  const catalog = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '你好', locations: [first] },
      { value: '你好', locations: [second] }
    ])
  ])
  const metadata = catalogMetadata(catalog, { sourceLocale: 'zh', format: 'json' })
  assert.strictEqual(metadata.version, 2)
  const keys = Object.keys(metadata.entries).sort()
  assert.strictEqual(keys.length, 2)

  const [earlier, later] = keys.map(key => metadata.entries[key]).sort((a, b) => (
    a.occurrences[0].location.start.line - b.occurrences[0].location.start.line
  ))
  assert.strictEqual(earlier.occurrences.length, 1)
  assert.strictEqual(later.occurrences.length, 1)
  assert.deepStrictEqual(earlier.occurrences[0].location, first)
  assert.deepStrictEqual(later.occurrences[0].location, second)
  assert.strictEqual(earlier.occurrences[0].semanticHost, 'src/a.js::script')
  assert.strictEqual(later.occurrences[0].semanticHost, 'src/a.js::script')
  assert.strictEqual(earlier.occurrences[0].childRole, 'script-string')
  assert.strictEqual(later.occurrences[0].childRole, 'script-string')
  assert.strictEqual(earlier.occurrences[0].localContext, 'sibling:0')
  assert.strictEqual(later.occurrences[0].localContext, 'sibling:1')
  assert.strictEqual(earlier.occurrences[0].origin, 'derived')
  assert.strictEqual(later.occurrences[0].origin, 'derived')
  assert.match(earlier.occurrences[0].id, /^[0-9a-f]{16}$/)
  assert.match(later.occurrences[0].id, /^[0-9a-f]{16}$/)
  assert.notStrictEqual(earlier.occurrences[0].id, later.occurrences[0].id)

  const movedCatalog = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '改写', locations: [movedFirst] },
      { value: '你好', locations: [movedSecond] }
    ])
  ])
  const movedMeta = catalogMetadata(movedCatalog, { sourceLocale: 'zh', format: 'json' })
  const movedEarlier = Object.values(movedMeta.entries).find(entry => entry.occurrences[0].localContext === 'sibling:0')
  const movedLater = Object.values(movedMeta.entries).find(entry => entry.occurrences[0].localContext === 'sibling:1')
  assert.strictEqual(movedEarlier.occurrences[0].id, earlier.occurrences[0].id)
  assert.strictEqual(movedLater.occurrences[0].id, later.occurrences[0].id)
  assert.notStrictEqual(movedEarlier.source, earlier.source)
  assert.notDeepStrictEqual(movedEarlier.occurrences[0].location, earlier.occurrences[0].location)
})

test('an automatic key is readable, deterministic, and unique per occurrence', () => {
  const here = at('src/pages/Home.vue', 'html-text', 4, 2)
  const key = automaticKey({ path: 'src/pages/Home.vue', kind: 'html-text', value: '首页', location: here })
  assert.match(key, /^src\.pages\.Home\.[0-9a-f]{8}$/)
  assert.strictEqual(automaticKey({ path: 'src/pages/Home.vue', kind: 'html-text', value: '首页', location: here }), key)
  assert.notStrictEqual(
    automaticKey({ path: 'src/pages/Home.vue', kind: 'html-attribute', value: '首页', location: at('src/pages/Home.vue', 'html-attribute', 4, 2) }),
    key
  )
  assert.notStrictEqual(
    automaticKey({ path: 'src/pages/About.vue', kind: 'html-text', value: '首页', location: at('src/pages/About.vue', 'html-text', 4, 2) }),
    key
  )
  assert.notStrictEqual(
    automaticKey({ path: 'src/pages/Home.vue', kind: 'html-text', value: '主页', location: here }),
    key
  )
  assert.notStrictEqual(
    automaticKey({ path: 'src/pages/Home.vue', kind: 'html-text', value: '首页', location: at('src/pages/Home.vue', 'html-text', 9, 0) }),
    key
  )
  assert.match(
    automaticKey({ path: 'src/my page/1-a.b.js', kind: 'script-string', value: '文', location: at('src/my page/1-a.b.js', 'script-string', 1, 0) }),
    /^src\.my_page\.1-a_b\.[0-9a-f]{8}$/
  )
  for (const path of ['_app.js', '1.js', '首页.vue', '-x/y.js']) {
    const keyForPath = automaticKey({ path, kind: 'script-string', value: '文', location: at(path, 'script-string', 1, 0) })
    assert.ok(isLocalizationKey(keyForPath), `${keyForPath} is a valid key`)
  }
  assert.match(
    automaticKey({ path: '_app.js', kind: 'script-string', value: '文', location: at('_app.js', 'script-string', 1, 0) }),
    /^k_app\.[0-9a-f]{8}$/
  )
  assert.throws(
    () => automaticKey({ path: 'src/a.js', kind: 'script-string', value: '文' }),
    /Automatic key requires a source location/
  )

  const first = buildCatalog([snapshot('src/a.js::script', [{ value: '你好', locations: [at('src/a.js', 'script-string', 1, 10)] }])])
  const moved = buildCatalog([snapshot('src/a.js::script', [{ value: '你好', locations: [at('src/a.js', 'script-string', 9, 3)] }])])
  assert.notDeepStrictEqual(Object.keys(moved.messages), Object.keys(first.messages))
})

test('subsequent collection reuses an automatic key when structural anchors uniquely match history', () => {
  const firstLocation = at('src/a.js', 'script-string', 1, 10)
  const first = buildCatalog([snapshot('src/a.js::script', [{ value: '你好', locations: [firstLocation] }])])
  const previousMetadata = catalogMetadata(first, { sourceLocale: 'zh', format: 'json' })
  const [originalKey] = Object.keys(first.messages)
  assert.strictEqual(first.messages[originalKey], '你好')

  const edited = buildCatalog(
    [snapshot('src/a.js::script', [{ value: '您好', locations: [at('src/a.js', 'script-string', 4, 2)] }])],
    { previousMetadata }
  )
  assert.deepStrictEqual(Object.keys(edited.messages), [originalKey])
  assert.strictEqual(edited.messages[originalKey], '您好')
  assert.strictEqual(edited.entries[originalKey].occurrences[0].localContext, 'sibling:0')
  assert.strictEqual(
    edited.entries[originalKey].occurrences[0].id,
    previousMetadata.entries[originalKey].occurrences[0].id
  )

  const withoutHistory = buildCatalog([
    snapshot('src/a.js::script', [{ value: '您好', locations: [at('src/a.js', 'script-string', 4, 2)] }])
  ])
  assert.notDeepStrictEqual(Object.keys(withoutHistory.messages), [originalKey])
})

test('automatic key reuse keeps sibling context aligned when an explicit key shares the host', () => {
  const first = buildCatalog([
    snapshot('src/a.js::script', [
      { key: 'home.title', value: '首页', locations: [at('src/a.js', 'script-string', 1, 0)] },
      { value: '你好', locations: [at('src/a.js', 'script-string', 2, 0)] }
    ])
  ])
  const previousMetadata = catalogMetadata(first, { sourceLocale: 'zh', format: 'json' })
  const helloKey = Object.keys(first.messages).find(key => first.messages[key] === '你好')
  assert.strictEqual(previousMetadata.entries[helloKey].occurrences[0].localContext, 'sibling:1')

  const edited = buildCatalog(
    [snapshot('src/a.js::script', [
      { key: 'home.title', value: '主页', locations: [at('src/a.js', 'script-string', 3, 0)] },
      { value: '您好', locations: [at('src/a.js', 'script-string', 4, 0)] }
    ])],
    { previousMetadata }
  )
  assert.strictEqual(edited.messages[helloKey], '您好')
  assert.strictEqual(edited.messages['home.title'], '主页')
})

test('collection history reuses keys across sibling inserts, ordinary moves, and safe file moves', () => {
  const first = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '你好', locations: [at('src/a.js', 'script-string', 1, 0)] },
      { value: '欢迎', locations: [at('src/a.js', 'script-string', 2, 0)] }
    ])
  ])
  const previousMetadata = catalogMetadata(first, { sourceLocale: 'zh', format: 'json' })
  const helloKey = Object.keys(first.messages).find(key => first.messages[key] === '你好')
  const welcomeKey = Object.keys(first.messages).find(key => first.messages[key] === '欢迎')

  const withInsert = buildCatalog(
    [snapshot('src/a.js::script', [
      { value: '新增', locations: [at('src/a.js', 'script-string', 1, 0)] },
      { value: '你好', locations: [at('src/a.js', 'script-string', 3, 0)] },
      { value: '欢迎', locations: [at('src/a.js', 'script-string', 4, 0)] }
    ])],
    { previousMetadata }
  )
  assert.strictEqual(withInsert.messages[helloKey], '你好')
  assert.strictEqual(withInsert.messages[welcomeKey], '欢迎')
  const insertedKey = Object.keys(withInsert.messages).find(key => withInsert.messages[key] === '新增')
  assert.ok(insertedKey)
  assert.notStrictEqual(insertedKey, helloKey)
  assert.notStrictEqual(insertedKey, welcomeKey)

  const shifted = buildCatalog(
    [snapshot('src/a.js::script', [
      { value: '你好', locations: [at('src/a.js', 'script-string', 8, 4)] },
      { value: '欢迎', locations: [at('src/a.js', 'script-string', 20, 0)] }
    ])],
    { previousMetadata }
  )
  assert.strictEqual(shifted.messages[helloKey], '你好')
  assert.strictEqual(shifted.messages[welcomeKey], '欢迎')

  const movedFile = buildCatalog(
    [snapshot('src/b.js::script', [
      { value: '改写', locations: [at('src/b.js', 'script-string', 1, 0)] },
      { value: '欢迎', locations: [at('src/b.js', 'script-string', 2, 0)] }
    ])],
    { previousMetadata }
  )
  assert.strictEqual(movedFile.messages[helloKey], '改写')
  assert.strictEqual(movedFile.messages[welcomeKey], '欢迎')
  assert.strictEqual(movedFile.entries[helloKey].occurrences[0].semanticHost, 'src/b.js::script')
})

test('unmatched occurrences receive new keys without reusing an unsafe historical identity', () => {
  const first = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '你好', locations: [at('src/a.js', 'script-string', 1, 0)] },
      { value: '你好', locations: [at('src/a.js', 'script-string', 2, 0)] }
    ])
  ])
  const previousMetadata = catalogMetadata(first, { sourceLocale: 'zh', format: 'json' })
  const previousKeys = Object.keys(first.messages).sort()
  assert.strictEqual(previousKeys.length, 2)

  const replaced = buildCatalog(
    [snapshot('src/a.js::script', [
      { value: '甲', locations: [at('src/a.js', 'script-string', 1, 0)] },
      { value: '乙', locations: [at('src/a.js', 'script-string', 2, 0)] }
    ])],
    { previousMetadata }
  )
  // Equal sibling counts: structural contexts uniquely match, so keys reuse despite text changes.
  assert.deepStrictEqual(Object.keys(replaced.messages).sort(), previousKeys)

  const ambiguous = buildCatalog(
    [snapshot('src/a.js::script', [
      { value: '新文案', locations: [at('src/a.js', 'script-string', 1, 0)] }
    ])],
    { previousMetadata }
  )
  // One current vs two historical candidates with no unique text match: allocate a fresh key.
  const [onlyKey] = Object.keys(ambiguous.messages)
  assert.strictEqual(ambiguous.messages[onlyKey], '新文案')
  assert.ok(!previousKeys.includes(onlyKey))

  const multiFileAmbiguous = buildCatalog(
    [
      snapshot('src/b.js::script', [{ value: '你好', locations: [at('src/b.js', 'script-string', 1, 0)] }]),
      snapshot('src/c.js::script', [{ value: '你好', locations: [at('src/c.js', 'script-string', 1, 0)] }])
    ],
    {
      previousMetadata: catalogMetadata(
        buildCatalog([
          snapshot('src/a.js::script', [{ value: '你好', locations: [at('src/a.js', 'script-string', 1, 0)] }]),
          snapshot('src/d.js::script', [{ value: '你好', locations: [at('src/d.js', 'script-string', 1, 0)] }])
        ]),
        { sourceLocale: 'zh', format: 'json' }
      )
    }
  )
  const multiKeys = Object.keys(multiFileAmbiguous.messages).sort()
  assert.strictEqual(multiKeys.length, 2)
  assert.ok(multiKeys.every(key => key.startsWith('src.b.') || key.startsWith('src.c.')))
})

test('identical text at distinct occurrences gets independent automatic keys across semantic kinds', () => {
  const scriptA = at('src/a.js', 'script-string', 1, 0)
  const scriptB = at('src/a.ts', 'script-string', 2, 8)
  const templateLiteral = at('src/b.ts', 'template-literal', 4, 12)
  const template = at('src/a.vue', 'html-text', 2, 4)
  const html = at('public/index.html', 'static-html-text', 5, 2)
  const css = at('src/a.css', 'css-generated-content', 1, 20)
  const catalog = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '你好', locations: [scriptA] }
    ]),
    snapshot('src/a.ts::script', [
      { value: '你好', locations: [scriptB] }
    ]),
    snapshot('src/b.ts::script', [
      { value: '你好', locations: [templateLiteral] }
    ]),
    snapshot('src/a.vue::template[lang=html]', [
      { value: '你好', locations: [template] }
    ]),
    snapshot('public/index.html::static-html', [
      { value: '你好', locations: [html] }
    ]),
    snapshot('src/a.css::style', [
      { value: '你好', locations: [css] }
    ])
  ])
  const keys = Object.keys(catalog.messages)
  const locations = [scriptA, scriptB, templateLiteral, template, html, css]
  assert.deepStrictEqual(catalog.conflicts, [])
  assert.strictEqual(keys.length, 6)
  assert.deepStrictEqual(new Set(Object.values(catalog.messages)), new Set(['你好']))
  for (const key of keys) {
    assert.strictEqual(catalog.entries[key].origin, 'derived')
    assert.strictEqual(catalog.entries[key].locations.length, 1)
  }
  assert.deepStrictEqual(
    keys.map(key => catalog.entries[key].locations[0]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    locations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  )
})

test('every collected location gets an explicit or automatic key, and an explicit key may gather locations', () => {
  const catalog = buildCatalog([
    snapshot('src/b.js::script', [
      { value: '首页', key: 'home.title', locations: [at('src/b.js', 'script-string', 2, 0)] },
      { value: '你好', locations: [at('src/b.js', 'script-string', 3, 0)] },
      { value: '你好', locations: [at('src/b.js', 'script-string', 1, 0)] }
    ]),
    snapshot('src/a.js::script', [
      { value: '首页', key: 'home.title', locations: [at('src/a.js', 'script-string', 5, 4)] },
      { value: '你好', locations: [at('src/a.js', 'script-string', 1, 0)] },
      { value: 'English only', locations: [at('src/a.js', 'script-string', 7, 0)] }
    ])
  ])
  const helloA = automaticKey({ path: 'src/a.js', kind: 'script-string', value: '你好', location: at('src/a.js', 'script-string', 1, 0) })
  const helloB1 = automaticKey({ path: 'src/b.js', kind: 'script-string', value: '你好', location: at('src/b.js', 'script-string', 1, 0) })
  const helloB3 = automaticKey({ path: 'src/b.js', kind: 'script-string', value: '你好', location: at('src/b.js', 'script-string', 3, 0) })
  assert.deepStrictEqual(catalog.conflicts, [])
  assert.deepStrictEqual(catalog.messages, {
    [helloA]: '你好',
    [helloB1]: '你好',
    [helloB3]: '你好',
    'home.title': '首页'
  })
  assert.deepStrictEqual(Object.keys(catalog.messages), [helloA, helloB1, helloB3, 'home.title'].sort())
  assert.strictEqual(catalog.entries['home.title'].source, '首页')
  assert.strictEqual(catalog.entries['home.title'].origin, 'explicit')
  assert.deepStrictEqual(catalog.entries['home.title'].locations, [at('src/a.js', 'script-string', 5, 4), at('src/b.js', 'script-string', 2, 0)])
  assert.strictEqual(catalog.entries['home.title'].occurrences.length, 2)
  assert.match(catalog.entries['home.title'].fingerprint, /^[0-9a-f]{16}$/)
  assert.strictEqual(catalog.entries[helloB1].origin, 'derived')
  assert.deepStrictEqual(catalog.entries[helloB1].locations, [at('src/b.js', 'script-string', 1, 0)])
  assert.deepStrictEqual(catalog.entries[helloB3].locations, [at('src/b.js', 'script-string', 3, 0)])
  assert.strictEqual(catalog.entries[helloA].fingerprint, catalog.entries[helloB1].fingerprint)
})

test('a key that names different source text is a conflict with every location reported', () => {
  const keptLocation = at('src/a.js', 'script-string', 2, 0)
  const automaticLocation = at('src/c.js', 'script-string', 4, 2)
  const colliding = automaticKey({ path: 'src/c.js', kind: 'script-string', value: '派生', location: automaticLocation })
  const catalog = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '首页', key: 'home.title', locations: [at('src/a.js', 'script-string', 1, 16)] },
      { value: '保留', locations: [keptLocation] }
    ]),
    snapshot('src/b.vue::template[lang=html]', [
      { value: '主页', key: 'home.title', locations: [at('src/b.vue', 'html-text', 3, 4)] }
    ]),
    snapshot('src/c.js::script', [
      { value: '派生', locations: [automaticLocation] },
      { value: '冒用', key: colliding, locations: [at('src/c.js', 'script-string', 6, 2)] }
    ])
  ])
  assert.deepStrictEqual(catalog.conflicts.map(conflict => conflict.key), [colliding, 'home.title'].sort())
  assert.deepStrictEqual(
    Object.keys(catalog.messages),
    [automaticKey({ path: 'src/a.js', kind: 'script-string', value: '保留', location: keptLocation })]
  )
  const message = conflictMessage(catalog.conflicts)
  assert.match(message, /^i18n-collect failed: 2 localization key conflicts/)
  assert.match(message, /"home\.title" names different source text/)
  assert.match(message, /"首页" \(explicit\) at src\/a\.js:1:16 \(script-string\)/)
  assert.match(message, /"主页" \(explicit\) at src\/b\.vue:3:4 \(html-text\)/)
  assert.match(message, /"派生" \(derived\) at src\/c\.js:4:2 \(script-string\)/)
  assert.match(message, /"冒用" \(explicit\) at src\/c\.js:6:2 \(script-string\)/)
})

function metadataOf(entries) {
  return catalogMetadata(buildCatalog([snapshot('src/a.js::script', entries)]), { sourceLocale: 'zh', format: 'json' })
}

test('catalog metadata records source identity so a later round can tell what changed', () => {
  const before = metadataOf([
    { value: '不变', key: 'same', locations: [at('src/a.js', 'script-string', 1, 0)] },
    { value: '旧文', key: 'edited', locations: [at('src/a.js', 'script-string', 2, 0)] },
    { value: '删除', key: 'gone', locations: [at('src/a.js', 'script-string', 3, 0)] }
  ])
  assert.deepStrictEqual(Object.keys(before), ['version', 'sourceLocale', 'format', 'entries'])
  assert.strictEqual(before.version, 2)
  assert.strictEqual(before.sourceLocale, 'zh')
  assert.strictEqual(before.format, 'json')
  assert.deepStrictEqual(before.entries.same.locations, [at('src/a.js', 'script-string', 1, 0)])
  assert.strictEqual(before.entries.same.occurrences.length, 1)

  const after = metadataOf([
    { value: '不变', key: 'same', locations: [at('src/a.js', 'script-string', 8, 0)] },
    { value: '新文', key: 'edited', locations: [at('src/a.js', 'script-string', 2, 0)] },
    { value: '新增', key: 'fresh', locations: [at('src/a.js', 'script-string', 4, 0)] }
  ])
  assert.deepStrictEqual(diffCatalog(before, after), {
    added: ['fresh'],
    removed: ['gone'],
    changed: ['edited'],
    unchanged: ['same']
  })
  assert.throws(
    () => diffCatalog({ version: 99, entries: before.entries }, after),
    /cannot be upgraded to version 2/
  )
  assert.deepStrictEqual(diffCatalog(null, after), {
    added: ['edited', 'fresh', 'same'],
    removed: [],
    changed: [],
    unchanged: []
  })
})

test('catalog metadata upgrades version 1 entries and rejects unsupported schemas', () => {
  const location = at('src/a.js', 'script-string', 1, 0)
  const v1 = {
    version: 1,
    sourceLocale: 'zh',
    format: 'json',
    entries: {
      'home.title': {
        source: '首页',
        fingerprint: 'abc',
        origin: 'explicit',
        locations: [location]
      }
    }
  }
  const upgraded = upgradeCatalogMetadata(v1)
  assert.strictEqual(upgraded.version, 2)
  assert.deepStrictEqual(upgraded.entries['home.title'].locations, [location])
  assert.strictEqual(upgraded.entries['home.title'].occurrences.length, 1)
  assert.strictEqual(upgraded.entries['home.title'].occurrences[0].semanticHost, 'src/a.js::script')
  assert.strictEqual(upgraded.entries['home.title'].occurrences[0].childRole, 'script-string')
  assert.strictEqual(upgraded.entries['home.title'].occurrences[0].localContext, 'sibling:0')
  assert.strictEqual(upgraded.entries['home.title'].occurrences[0].origin, 'explicit')
  assert.match(upgraded.entries['home.title'].occurrences[0].id, /^[0-9a-f]{16}$/)
  assert.deepStrictEqual(upgraded.entries['home.title'].occurrences[0].location, location)
  assert.deepStrictEqual(upgradeCatalogMetadata(upgraded), upgraded)

  assert.throws(
    () => upgradeCatalogMetadata({ version: 99, entries: {} }),
    /cannot be upgraded to version 2.*restore a version 1 or 2 catalog\.meta\.json/
  )
  assert.deepStrictEqual(
    upgradeCatalogMetadata({
      version: 1,
      entries: { sparse: { source: '首页', fingerprint: 'abc', origin: 'derived' } }
    }).entries.sparse.occurrences,
    []
  )
  assert.throws(
    () => upgradeCatalogMetadata({
      version: 1,
      entries: { broken: { source: '首页', fingerprint: 'abc', origin: 'derived', locations: 'nope' } }
    }),
    /invalid source locations/
  )
  assert.throws(
    () => upgradeCatalogMetadata({
      version: 2,
      entries: {
        broken: {
          source: '首页',
          fingerprint: 'abc',
          origin: 'derived',
          locations: [location]
        }
      }
    }),
    /missing occurrence identities/
  )
})

test('the default json adapter writes a stable flat locale mapping and reads it back', () => {
  const json = catalogFormat('json')
  assert.strictEqual(json.name, 'json')
  assert.strictEqual(json.extension, '.json')
  const text = json.serialize({ 'b.key': '乙', 'a.key': '甲' })
  assert.strictEqual(text, '{\n  "a.key": "甲",\n  "b.key": "乙"\n}\n')
  assert.deepStrictEqual(json.parse(text), { 'a.key': '甲', 'b.key': '乙' })
  assert.throws(() => json.parse('{"a": {"nested": "甲"}}'), /flat mapping of strings/)
  assert.throws(() => catalogFormat('yaml'), /unknown catalog format "yaml"/)
})
