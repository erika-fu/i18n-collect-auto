const assert = require('assert')
const test = require('node:test')
const {
  buildCatalog,
  catalogMetadata,
  diffCatalog,
  fingerprintOf,
  readRetirementConfirmations
} = require('../mycommon/catalog')
const { planTranslation, serializeState } = require('../mycommon/translate')
const fs = require('fs')
const os = require('os')
const path = require('path')

function at(filePath, kind, line, column, length = 2) {
  return { path: filePath, kind, start: { line, column }, end: { line, column: column + length } }
}

function snapshot(identity, entries) {
  return { identity, projectPath: identity.split('::')[0], entries }
}

function meta(catalog) {
  return catalogMetadata(catalog, { sourceLocale: 'zh', format: 'json' })
}

test('a missing occurrence becomes orphaned in metadata and drops from source messages', () => {
  const location = at('src/a.js', 'script-string', 1, 0)
  const first = buildCatalog([snapshot('src/a.js::script', [{ value: '你好', locations: [location] }])])
  const previousMetadata = meta(first)
  const [key] = Object.keys(first.messages)
  assert.strictEqual(previousMetadata.entries[key].status, 'active')

  const second = buildCatalog([], { previousMetadata })
  assert.deepStrictEqual(second.messages, {})
  assert.strictEqual(second.entries[key].status, 'orphaned')
  assert.strictEqual(second.entries[key].source, '你好')
  assert.strictEqual(second.entries[key].fingerprint, fingerprintOf('你好'))
  assert.deepStrictEqual(second.orphaned, [key])
  assert.deepStrictEqual(second.retired, [])

  const nextMeta = meta(second)
  assert.strictEqual(nextMeta.entries[key].status, 'orphaned')
  assert.deepStrictEqual(diffCatalog(previousMetadata, nextMeta), {
    added: [],
    removed: [],
    changed: [],
    unchanged: [],
    orphaned: [key],
    recovered: []
  })
})

test('an orphaned occurrence that returns reuses its localization key', () => {
  const firstLocation = at('src/a.js', 'script-string', 1, 0)
  const first = buildCatalog([snapshot('src/a.js::script', [{ value: '你好', locations: [firstLocation] }])])
  const previousMetadata = meta(first)
  const [key] = Object.keys(first.messages)
  const occurrenceId = previousMetadata.entries[key].occurrences[0].id

  const orphaned = buildCatalog([], { previousMetadata })
  const orphanedMeta = meta(orphaned)

  const returnedLocation = at('src/a.js', 'script-string', 9, 4)
  const recovered = buildCatalog(
    [snapshot('src/a.js::script', [{ value: '你好', locations: [returnedLocation] }])],
    { previousMetadata: orphanedMeta }
  )
  assert.deepStrictEqual(Object.keys(recovered.messages), [key])
  assert.strictEqual(recovered.entries[key].status, 'active')
  assert.strictEqual(recovered.entries[key].occurrences[0].id, occurrenceId)
  assert.deepStrictEqual(recovered.orphaned, [])
  assert.deepStrictEqual(diffCatalog(orphanedMeta, meta(recovered)), {
    added: [],
    removed: [],
    changed: [],
    unchanged: [],
    orphaned: [],
    recovered: [key]
  })
})

test('retirement confirmation retires an orphaned key from metadata', () => {
  const location = at('src/a.js', 'script-string', 1, 0)
  const first = buildCatalog([snapshot('src/a.js::script', [{ value: '你好', locations: [location] }])])
  const [key] = Object.keys(first.messages)
  const orphaned = buildCatalog([], { previousMetadata: meta(first) })
  const retired = buildCatalog([], {
    previousMetadata: meta(orphaned),
    retirements: [key]
  })
  assert.deepStrictEqual(retired.messages, {})
  assert.strictEqual(retired.entries[key], undefined)
  assert.deepStrictEqual(retired.orphaned, [])
  assert.deepStrictEqual(retired.retired, [key])
  assert.deepStrictEqual(diffCatalog(meta(orphaned), meta(retired)), {
    added: [],
    removed: [key],
    changed: [],
    unchanged: [],
    orphaned: [],
    recovered: []
  })
})

test('prune retires missing and previously orphaned keys without confirmation', () => {
  const keep = at('src/a.js', 'script-string', 1, 0)
  const drop = at('src/a.js', 'script-string', 2, 0)
  const first = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '保留', locations: [keep] },
      { value: '删除', locations: [drop] }
    ])
  ])
  const keepKey = Object.keys(first.messages).find(key => first.messages[key] === '保留')
  const dropKey = Object.keys(first.messages).find(key => first.messages[key] === '删除')
  const orphaned = buildCatalog(
    [snapshot('src/a.js::script', [{ value: '保留', locations: [keep] }])],
    { previousMetadata: meta(first) }
  )
  assert.strictEqual(orphaned.entries[dropKey].status, 'orphaned')

  const pruned = buildCatalog(
    [snapshot('src/a.js::script', [{ value: '保留', locations: [keep] }])],
    { previousMetadata: meta(orphaned), prune: true }
  )
  assert.deepStrictEqual(Object.keys(pruned.messages), [keepKey])
  assert.strictEqual(pruned.entries[dropKey], undefined)
  assert.deepStrictEqual(pruned.retired, [dropKey])
})

test('readRetirementConfirmations loads durable retirement keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-retire-'))
  const file = path.join(root, 'retirement-confirmations.json')
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    keys: ['home.gone', 'home.old']
  }, null, 2)}\n`)
  assert.deepStrictEqual(readRetirementConfirmations(file), ['home.gone', 'home.old'])
  assert.deepStrictEqual(readRetirementConfirmations(path.join(root, 'missing.json')), [])
})

test('planTranslation keeps orphaned translations and prunes retired keys from targets and review state', () => {
  const fingerprint = fingerprintOf('你好')
  const plan = planTranslation({
    entries: {
      'home.live': { source: '在线', fingerprint: fingerprintOf('在线') }
    },
    retainedKeys: ['home.live', 'home.orphan'],
    targets: {
      en: {
        'home.live': 'Live',
        'home.orphan': 'Orphan',
        'home.retired': 'Gone'
      }
    },
    state: {
      version: 1,
      locales: {
        en: {
          'home.live': { sourceFingerprint: fingerprintOf('在线'), review: 'current' },
          'home.orphan': { sourceFingerprint: fingerprint, review: 'current' },
          'home.retired': { sourceFingerprint: fingerprint, review: 'needs-review' }
        }
      }
    },
    locales: ['en']
  })
  assert.deepStrictEqual(plan.nextTargets.en, {
    'home.live': 'Live',
    'home.orphan': 'Orphan'
  })
  assert.strictEqual(plan.nextState.locales.en['home.retired'], undefined)
  assert.deepStrictEqual(plan.pruned, [{ key: 'home.retired', locale: 'en' }])
  assert.deepStrictEqual(plan.kept, [
    { key: 'home.live', locale: 'en' }
  ])
  const serialized = JSON.parse(serializeState(plan.nextState))
  assert.strictEqual(serialized.locales.en['home.retired'], undefined)
  assert.strictEqual(serialized.locales.en['home.orphan'].review, 'current')
})

test('a source fingerprint change keeps the existing translation and marks needs-review', () => {
  const previous = fingerprintOf('首页')
  const plan = planTranslation({
    entries: {
      'home.title': { source: '主页', fingerprint: fingerprintOf('主页') }
    },
    targets: { en: { 'home.title': 'Home' } },
    state: {
      version: 1,
      locales: {
        en: { 'home.title': { sourceFingerprint: previous, review: 'current' } }
      }
    },
    locales: ['en']
  })
  assert.strictEqual(plan.nextTargets.en['home.title'], 'Home')
  assert.deepStrictEqual(plan.nextState.locales.en['home.title'], {
    sourceFingerprint: previous,
    review: 'needs-review'
  })
  assert.deepStrictEqual(plan.kept, [{ key: 'home.title', locale: 'en' }])
})
