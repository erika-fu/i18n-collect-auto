const assert = require('assert')
const test = require('node:test')
const {
  REPRESENTATION_LOCALIZED_CALL,
  REPRESENTATION_SOURCE_TEXT,
  buildCatalog,
  catalogMetadata,
  fingerprintOf,
  referenceMessage
} = require('../mycommon/catalog')

function at(filePath, kind, line, column, length = 2) {
  return { path: filePath, kind, start: { line, column }, end: { line, column: column + length } }
}

function snapshot(identity, entries) {
  return { identity, projectPath: identity.split('::')[0], entries }
}

function meta(catalog) {
  return catalogMetadata(catalog, { sourceLocale: 'zh', format: 'json' })
}

test('a localized-call occurrence keeps a known key active and updates its location', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{ value: '你好', locations: [sourceLocation] }])
  ])
  const [key] = Object.keys(first.messages)
  const callLocation = at('src/a.js', 'script-string', 4, 8, 12)
  const second = buildCatalog(
    [snapshot('src/a.js::script', [{
      key,
      value: '',
      representation: REPRESENTATION_LOCALIZED_CALL,
      locations: [callLocation]
    }])],
    { previousMetadata: meta(first) }
  )
  assert.deepStrictEqual(Object.keys(second.messages), [key])
  assert.strictEqual(second.messages[key], '你好')
  assert.strictEqual(second.entries[key].status, 'active')
  assert.strictEqual(second.entries[key].source, '你好')
  assert.strictEqual(second.entries[key].fingerprint, fingerprintOf('你好'))
  assert.strictEqual(second.entries[key].representation, REPRESENTATION_LOCALIZED_CALL)
  assert.deepStrictEqual(second.entries[key].locations, [callLocation])
  assert.strictEqual(second.entries[key].occurrences[0].representation, REPRESENTATION_LOCALIZED_CALL)
  assert.deepStrictEqual(second.entries[key].occurrences[0].location, callLocation)
  assert.deepStrictEqual(second.orphaned, [])
})

test('a localized call recovers a non-retired orphaned key', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{ value: '你好', locations: [sourceLocation] }])
  ])
  const [key] = Object.keys(first.messages)
  const orphaned = buildCatalog([], { previousMetadata: meta(first) })
  assert.strictEqual(orphaned.entries[key].status, 'orphaned')

  const callLocation = at('src/b.js', 'script-string', 2, 4, 10)
  const recovered = buildCatalog(
    [snapshot('src/b.js::script', [{
      key,
      value: '',
      representation: REPRESENTATION_LOCALIZED_CALL,
      locations: [callLocation]
    }])],
    { previousMetadata: meta(orphaned) }
  )
  assert.strictEqual(recovered.entries[key].status, 'active')
  assert.strictEqual(recovered.messages[key], '你好')
  assert.deepStrictEqual(recovered.orphaned, [])
  assert.strictEqual(recovered.entries[key].occurrences[0].representation, REPRESENTATION_LOCALIZED_CALL)
  assert.strictEqual(recovered.entries[key].occurrences[0].semanticHost, 'src/b.js::script')
  assert.strictEqual(recovered.entries[key].occurrences[0].childRole, 'script-string')
})

test('referenceMessage explains unknown and retired localized-call failures', () => {
  const location = at('src/a.js', 'script-string', 1, 0, 10)
  const message = referenceMessage([
    { key: 'missing.key', reason: 'unknown', location },
    { key: 'gone.key', reason: 'retired', location: at('src/b.js', 'script-string', 2, 0, 8) }
  ])
  assert.match(message, /2 localization key references/)
  assert.match(message, /"missing\.key" is a unknown project key at src\/a\.js:1:0 \(script-string\)/)
  assert.match(message, /"gone\.key" is a retired project key at src\/b\.js:2:0 \(script-string\)/)
  assert.match(message, /externalKeys/)
})

test('an unknown project key referenced by a localized call fails collection', () => {
  const callLocation = at('src/a.js', 'script-string', 1, 0, 10)
  const catalog = buildCatalog([
    snapshot('src/a.js::script', [{
      key: 'missing.key',
      value: '',
      representation: REPRESENTATION_LOCALIZED_CALL,
      locations: [callLocation]
    }])
  ])
  assert.deepStrictEqual(catalog.referenceErrors, [
    { key: 'missing.key', reason: 'unknown', location: callLocation }
  ])
})

test('a retired project key referenced by a localized call fails collection', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{ value: '你好', locations: [sourceLocation] }])
  ])
  const [key] = Object.keys(first.messages)
  const orphaned = buildCatalog([], { previousMetadata: meta(first) })
  const retired = buildCatalog([], {
    previousMetadata: meta(orphaned),
    retirements: [key]
  })
  assert.strictEqual(retired.entries[key], undefined)

  const callLocation = at('src/a.js', 'script-string', 3, 2, 8)
  const catalog = buildCatalog(
    [snapshot('src/a.js::script', [{
      key,
      value: '',
      representation: REPRESENTATION_LOCALIZED_CALL,
      locations: [callLocation]
    }])],
    { previousMetadata: meta(retired), retirements: [key] }
  )
  assert.deepStrictEqual(catalog.referenceErrors, [
    { key, reason: 'retired', location: callLocation }
  ])
})

test('legacy MD5 dictionary calls do not fail collection or create catalog entries', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{ value: '你好', locations: [sourceLocation] }])
  ])
  const [projectKey] = Object.keys(first.messages)
  const hash = fingerprintOf('你好').padEnd(32, '0').slice(0, 32)
  const callLocation = at('src/a.js', 'script-string', 2, 0, 34)
  const catalog = buildCatalog(
    [snapshot('src/a.js::script', [
      {
        key: projectKey,
        value: '',
        representation: REPRESENTATION_LOCALIZED_CALL,
        locations: [callLocation]
      },
      {
        key: hash,
        value: '',
        representation: REPRESENTATION_LOCALIZED_CALL,
        locations: [at('src/a.js', 'script-string', 3, 0, 34)]
      }
    ])],
    { previousMetadata: meta(first) }
  )
  assert.deepStrictEqual(catalog.referenceErrors, [])
  assert.deepStrictEqual(Object.keys(catalog.messages), [projectKey])
  assert.strictEqual(catalog.entries[hash], undefined)
})

test('externalKeys allow unknown keys without creating project catalog entries', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{ value: '你好', locations: [sourceLocation] }])
  ])
  const [projectKey] = Object.keys(first.messages)
  const callLocation = at('src/a.js', 'script-string', 2, 0, 12)
  const externalLocation = at('src/a.js', 'script-string', 3, 0, 14)
  const catalog = buildCatalog(
    [snapshot('src/a.js::script', [
      {
        key: projectKey,
        value: '',
        representation: REPRESENTATION_LOCALIZED_CALL,
        locations: [callLocation]
      },
      {
        key: 'vendor.external',
        value: '',
        representation: REPRESENTATION_LOCALIZED_CALL,
        locations: [externalLocation]
      }
    ])],
    {
      previousMetadata: meta(first),
      externalKeys: ['vendor.external']
    }
  )
  assert.deepStrictEqual(catalog.referenceErrors, [])
  assert.deepStrictEqual(Object.keys(catalog.messages), [projectKey])
  assert.strictEqual(catalog.entries['vendor.external'], undefined)
  assert.strictEqual(catalog.entries[projectKey].representation, REPRESENTATION_LOCALIZED_CALL)
})

test('a same-round source-text occurrence can satisfy a localized-call reference', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const callLocation = at('src/a.js', 'script-string', 2, 0, 12)
  const catalog = buildCatalog([
    snapshot('src/a.js::script', [
      {
        value: '你好',
        key: 'home.title',
        locations: [sourceLocation]
      },
      {
        key: 'home.title',
        value: '',
        representation: REPRESENTATION_LOCALIZED_CALL,
        locations: [callLocation]
      }
    ])
  ])
  assert.deepStrictEqual(catalog.referenceErrors, [])
  assert.strictEqual(catalog.messages['home.title'], '你好')
  assert.strictEqual(catalog.entries['home.title'].representation, REPRESENTATION_SOURCE_TEXT)
  const representations = catalog.entries['home.title'].occurrences.map(item => item.representation).sort()
  assert.deepStrictEqual(representations, [REPRESENTATION_LOCALIZED_CALL, REPRESENTATION_SOURCE_TEXT])
})
