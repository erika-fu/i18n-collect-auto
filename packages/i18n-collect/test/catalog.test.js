const assert = require('assert')
const test = require('node:test')
const { automaticKey, buildCatalog, catalogMetadata, conflictMessage, diffCatalog } = require('../mycommon/catalog')
const { catalogFormat } = require('../mycommon/catalog-format')
const { isLocalizationKey } = require('../myloader/directives')

function at(path, kind, line, column, length = 2) {
  return { path, kind, start: { line, column }, end: { line, column: column + length } }
}

function snapshot(identity, entries) {
  return { identity, entries }
}

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
  assert.deepStrictEqual(catalog.entries['home.title'], {
    source: '首页',
    fingerprint: catalog.entries['home.title'].fingerprint,
    origin: 'explicit',
    locations: [at('src/a.js', 'script-string', 5, 4), at('src/b.js', 'script-string', 2, 0)]
  })
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
  assert.strictEqual(before.version, 1)
  assert.strictEqual(before.sourceLocale, 'zh')
  assert.strictEqual(before.format, 'json')
  assert.deepStrictEqual(before.entries.same.locations, [at('src/a.js', 'script-string', 1, 0)])

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
  assert.deepStrictEqual(diffCatalog({ version: 99, entries: before.entries }, after).removed, [])
  assert.deepStrictEqual(diffCatalog(null, after), {
    added: ['edited', 'fresh', 'same'],
    removed: [],
    changed: [],
    unchanged: []
  })
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
