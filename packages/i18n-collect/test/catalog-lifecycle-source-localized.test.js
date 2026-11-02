const assert = require('assert')
const test = require('node:test')
const {
  REPRESENTATION_LOCALIZED_CALL,
  REPRESENTATION_SOURCE_TEXT,
  buildCatalog,
  catalogMetadata,
  diffCatalog,
  fingerprintOf
} = require('../mycommon/catalog')
const { planTranslation } = require('../mycommon/translate')

function at(filePath, kind, line, column, length = 2) {
  return { path: filePath, kind, start: { line, column }, end: { line, column: column + length } }
}

function snapshot(identity, entries) {
  return { identity, projectPath: identity.split('::')[0], entries }
}

function meta(catalog) {
  return catalogMetadata(catalog, { sourceLocale: 'zh', format: 'json' })
}

function callEntry(key, location) {
  return {
    key,
    value: '',
    representation: REPRESENTATION_LOCALIZED_CALL,
    locations: [location]
  }
}

test('a compatible source-text occurrence supplies the canonical source for mixed representations', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const callLocation = at('src/a.js', 'script-string', 2, 0, 12)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{
      key: 'home.title',
      value: '你好',
      locations: [sourceLocation]
    }])
  ])
  const mixed = buildCatalog(
    [snapshot('src/a.js::script', [
      {
        key: 'home.title',
        value: '你好',
        locations: [sourceLocation]
      },
      callEntry('home.title', callLocation)
    ])],
    { previousMetadata: meta(first) }
  )

  assert.deepStrictEqual(mixed.referenceErrors, [])
  assert.strictEqual(mixed.messages['home.title'], '你好')
  assert.strictEqual(mixed.entries['home.title'].source, '你好')
  assert.strictEqual(mixed.entries['home.title'].fingerprint, fingerprintOf('你好'))
  assert.strictEqual(mixed.entries['home.title'].representation, REPRESENTATION_SOURCE_TEXT)
  const representations = mixed.entries['home.title'].occurrences
    .map(item => item.representation)
    .sort()
  assert.deepStrictEqual(representations, [REPRESENTATION_LOCALIZED_CALL, REPRESENTATION_SOURCE_TEXT])

  const published = meta(mixed)
  assert.strictEqual(published.entries['home.title'].source, '你好')
  assert.strictEqual(published.entries['home.title'].representation, REPRESENTATION_SOURCE_TEXT)
  assert.deepStrictEqual(
    published.entries['home.title'].occurrences.map(item => item.representation).sort(),
    [REPRESENTATION_LOCALIZED_CALL, REPRESENTATION_SOURCE_TEXT]
  )
})

test('when all active occurrences are localized calls the last canonical source remains available', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{
      key: 'home.title',
      value: '你好',
      locations: [sourceLocation]
    }])
  ])
  const callOnly = buildCatalog(
    [snapshot('src/a.js::script', [callEntry('home.title', at('src/a.js', 'script-string', 4, 8, 12))])],
    { previousMetadata: meta(first) }
  )

  assert.strictEqual(callOnly.messages['home.title'], '你好')
  assert.strictEqual(callOnly.entries['home.title'].source, '你好')
  assert.strictEqual(callOnly.entries['home.title'].fingerprint, fingerprintOf('你好'))
  assert.strictEqual(callOnly.entries['home.title'].representation, REPRESENTATION_LOCALIZED_CALL)
  assert.strictEqual(
    callOnly.entries['home.title'].occurrences[0].representation,
    REPRESENTATION_LOCALIZED_CALL
  )

  const stillCallOnly = buildCatalog(
    [snapshot('src/a.js::script', [callEntry('home.title', at('src/a.js', 'script-string', 5, 0, 10))])],
    { previousMetadata: meta(callOnly) }
  )
  assert.strictEqual(stillCallOnly.messages['home.title'], '你好')
  assert.strictEqual(stillCallOnly.entries['home.title'].fingerprint, fingerprintOf('你好'))
  assert.deepStrictEqual(diffCatalog(meta(callOnly), meta(stillCallOnly)), {
    added: [],
    removed: [],
    changed: [],
    unchanged: ['home.title'],
    orphaned: [],
    recovered: []
  })
})

test('a localized call never replaces canonical source text with an empty value', () => {
  const first = buildCatalog([
    snapshot('src/a.js::script', [{
      key: 'home.title',
      value: '你好',
      locations: [at('src/a.js', 'script-string', 1, 0, 4)]
    }])
  ])
  const callOnly = buildCatalog(
    [snapshot('src/a.js::script', [callEntry('home.title', at('src/a.js', 'script-string', 2, 0, 12))])],
    { previousMetadata: meta(first) }
  )
  assert.strictEqual(callOnly.entries['home.title'].source, '你好')
  assert.notStrictEqual(callOnly.entries['home.title'].source, '')
  assert.strictEqual(callOnly.messages['home.title'], '你好')
})

test('a uniquely matched source-text change preserves the key and updates the source fingerprint', () => {
  const first = buildCatalog([
    snapshot('src/a.js::script', [{
      value: '你好',
      locations: [at('src/a.js', 'script-string', 1, 0, 4)]
    }])
  ])
  const [key] = Object.keys(first.messages)
  const previousFingerprint = first.entries[key].fingerprint
  assert.strictEqual(previousFingerprint, fingerprintOf('你好'))

  const afterReplace = buildCatalog(
    [snapshot('src/a.js::script', [callEntry(key, at('src/a.js', 'script-string', 1, 0, 12))])],
    { previousMetadata: meta(first) }
  )
  assert.strictEqual(afterReplace.entries[key].fingerprint, previousFingerprint)

  const edited = buildCatalog(
    [snapshot('src/a.js::script', [{
      value: '您好',
      locations: [at('src/a.js', 'script-string', 3, 2, 4)]
    }])],
    { previousMetadata: meta(afterReplace) }
  )
  assert.deepStrictEqual(Object.keys(edited.messages), [key])
  assert.strictEqual(edited.messages[key], '您好')
  assert.strictEqual(edited.entries[key].fingerprint, fingerprintOf('您好'))
  assert.notStrictEqual(edited.entries[key].fingerprint, previousFingerprint)
  assert.deepStrictEqual(diffCatalog(meta(afterReplace), meta(edited)), {
    added: [],
    removed: [],
    changed: [key],
    unchanged: [],
    orphaned: [],
    recovered: []
  })
})

test('existing target translations become needs-review after a source change across localized lifecycle', () => {
  const first = buildCatalog([
    snapshot('src/a.js::script', [{
      key: 'home.title',
      value: '你好',
      locations: [at('src/a.js', 'script-string', 1, 0, 4)]
    }])
  ])
  const callOnly = buildCatalog(
    [snapshot('src/a.js::script', [callEntry('home.title', at('src/a.js', 'script-string', 2, 0, 12))])],
    { previousMetadata: meta(first) }
  )
  const edited = buildCatalog(
    [snapshot('src/a.js::script', [
      {
        key: 'home.title',
        value: '您好',
        locations: [at('src/a.js', 'script-string', 3, 0, 4)]
      },
      callEntry('home.title', at('src/a.js', 'script-string', 4, 0, 12))
    ])],
    { previousMetadata: meta(callOnly) }
  )
  assert.strictEqual(edited.entries['home.title'].fingerprint, fingerprintOf('您好'))
  assert.strictEqual(edited.entries['home.title'].representation, REPRESENTATION_SOURCE_TEXT)

  const plan = planTranslation({
    entries: {
      'home.title': {
        source: edited.entries['home.title'].source,
        fingerprint: edited.entries['home.title'].fingerprint
      }
    },
    targets: { en: { 'home.title': 'Hello' } },
    state: {
      version: 1,
      locales: {
        en: {
          'home.title': {
            sourceFingerprint: fingerprintOf('你好'),
            review: 'current'
          }
        }
      }
    },
    locales: ['en']
  })
  assert.strictEqual(plan.nextTargets.en['home.title'], 'Hello')
  assert.deepStrictEqual(plan.nextState.locales.en['home.title'], {
    sourceFingerprint: fingerprintOf('你好'),
    review: 'needs-review'
  })
  assert.deepStrictEqual(plan.kept, [{ key: 'home.title', locale: 'en' }])
})

test('incompatible message contracts still fail collection with mixed localized-call occurrences', () => {
  const catalog = buildCatalog([
    snapshot('src/a.js::script', [
      {
        key: 'home.title',
        value: '你好',
        locations: [at('src/a.js', 'script-string', 1, 0, 4)]
      },
      {
        key: 'home.title',
        value: '您好{name}',
        locations: [at('src/b.js', 'script-string', 1, 0, 8)]
      },
      callEntry('home.title', at('src/a.js', 'script-string', 2, 0, 12))
    ])
  ])
  assert.strictEqual(catalog.conflicts.length, 1)
  assert.strictEqual(catalog.conflicts[0].key, 'home.title')
  assert.strictEqual(catalog.conflicts[0].variants.length, 2)
  assert.deepStrictEqual(catalog.messages, {})
  assert.deepStrictEqual(catalog.referenceErrors, [])
})
