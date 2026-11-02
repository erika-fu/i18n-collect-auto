const assert = require('assert')
const test = require('node:test')
const {
  REPRESENTATION_LOCALIZED_CALL,
  buildCatalog,
  catalogMetadata,
  diffCatalog,
  fingerprintOf,
  referenceMessage
} = require('../mycommon/catalog')
const { planTranslation } = require('../mycommon/translate')

function at(filePath, kind, line, column, length = 2) {
  return { path: filePath, kind, start: { line, column }, end: { line, column: length + column } }
}

function snapshot(identity, entries) {
  return { identity, projectPath: identity.split('::')[0], entries }
}

function meta(catalog) {
  return catalogMetadata(catalog, { sourceLocale: 'zh', format: 'json' })
}

function callEntry(key, location, options = {}) {
  return {
    key,
    value: '',
    representation: REPRESENTATION_LOCALIZED_CALL,
    locations: [location],
    ...(options.paramNames ? { paramNames: options.paramNames } : {}),
    ...(options.paramsKind ? { paramsKind: options.paramsKind } : {})
  }
}

test('a manifest declaration seeds a localized-call catalog entry with explicit origin', () => {
  const callLocation = at('src/a.js', 'script-string', 1, 0, 24)
  const catalog = buildCatalog(
    [snapshot('src/a.js::script', [
      callEntry('items.deleted', callLocation, { paramNames: ['count'], paramsKind: 'static' })
    ])],
    {
      explicitMessages: [
        { key: 'items.deleted', source: '已删除 {count} 项' }
      ]
    }
  )
  assert.deepStrictEqual(catalog.referenceErrors, [])
  assert.strictEqual(catalog.messages['items.deleted'], '已删除 {count} 项')
  assert.strictEqual(catalog.entries['items.deleted'].origin, 'explicit')
  assert.strictEqual(catalog.entries['items.deleted'].representation, REPRESENTATION_LOCALIZED_CALL)
  assert.strictEqual(catalog.entries['items.deleted'].fingerprint, fingerprintOf('已删除 {count} 项'))
  assert.strictEqual(catalog.entries['items.deleted'].occurrences[0].representation, REPRESENTATION_LOCALIZED_CALL)
})

test('manifest-only declarations without a call do not publish an active entry', () => {
  const catalog = buildCatalog([], {
    explicitMessages: [
      { key: 'items.deleted', source: '已删除 {count} 项' }
    ]
  })
  assert.strictEqual(catalog.messages['items.deleted'], undefined)
  assert.strictEqual(catalog.entries['items.deleted'], undefined)
})

test('placeholder mismatches and dynamic params fail without publishing the key', () => {
  const mismatchLocation = at('src/a.js', 'script-string', 1, 0, 20)
  const dynamicLocation = at('src/b.js', 'script-string', 2, 0, 18)
  const missingLocation = at('src/c.js', 'script-string', 3, 0, 16)
  const catalog = buildCatalog(
    [
      snapshot('src/a.js::script', [
        callEntry('items.deleted', mismatchLocation, { paramNames: ['total'], paramsKind: 'static' })
      ]),
      snapshot('src/b.js::script', [
        callEntry('items.deleted', dynamicLocation, { paramsKind: 'dynamic' })
      ]),
      snapshot('src/c.js::script', [
        callEntry('items.deleted', missingLocation, { paramNames: [], paramsKind: 'none' })
      ])
    ],
    {
      explicitMessages: [
        { key: 'items.deleted', source: '已删除 {count} 项' }
      ]
    }
  )
  assert.deepStrictEqual(catalog.referenceErrors.map(item => item.reason).sort(), [
    'dynamic-params',
    'placeholder-mismatch',
    'placeholder-mismatch'
  ])
  assert.strictEqual(catalog.messages['items.deleted'], undefined)
  const message = referenceMessage(catalog.referenceErrors)
  assert.match(message, /placeholder mismatch/)
  assert.match(message, /dynamic parameters/)
})

test('editing an explicit message source keeps the key and marks translations for review', () => {
  const callLocation = at('src/a.js', 'script-string', 1, 0, 24)
  const first = buildCatalog(
    [snapshot('src/a.js::script', [
      callEntry('items.deleted', callLocation, { paramNames: ['count'], paramsKind: 'static' })
    ])],
    {
      explicitMessages: [
        { key: 'items.deleted', source: '已删除 {count} 项' }
      ]
    }
  )
  const edited = buildCatalog(
    [snapshot('src/a.js::script', [
      callEntry('items.deleted', callLocation, { paramNames: ['count'], paramsKind: 'static' })
    ])],
    {
      previousMetadata: meta(first),
      explicitMessages: [
        { key: 'items.deleted', source: '删除了 {count} 条' }
      ]
    }
  )
  assert.deepStrictEqual(Object.keys(edited.messages), ['items.deleted'])
  assert.strictEqual(edited.messages['items.deleted'], '删除了 {count} 条')
  assert.strictEqual(edited.entries['items.deleted'].fingerprint, fingerprintOf('删除了 {count} 条'))
  assert.deepStrictEqual(diffCatalog(meta(first), meta(edited)), {
    added: [],
    removed: [],
    changed: ['items.deleted'],
    unchanged: [],
    orphaned: [],
    recovered: []
  })
  const plan = planTranslation({
    entries: {
      'items.deleted': {
        source: edited.entries['items.deleted'].source,
        fingerprint: edited.entries['items.deleted'].fingerprint
      }
    },
    targets: { en: { 'items.deleted': 'Deleted {count} items' } },
    state: {
      version: 1,
      locales: {
        en: {
          'items.deleted': {
            sourceFingerprint: fingerprintOf('已删除 {count} 项'),
            review: 'current'
          }
        }
      }
    },
    locales: ['en']
  })
  assert.deepStrictEqual(plan.nextState.locales.en['items.deleted'], {
    sourceFingerprint: fingerprintOf('已删除 {count} 项'),
    review: 'needs-review'
  })
})

test('an orphaned explicit message recovers when its localized call returns', () => {
  const callLocation = at('src/a.js', 'script-string', 1, 0, 24)
  const first = buildCatalog(
    [snapshot('src/a.js::script', [
      callEntry('items.deleted', callLocation, { paramNames: ['count'], paramsKind: 'static' })
    ])],
    {
      explicitMessages: [
        { key: 'items.deleted', source: '已删除 {count} 项' }
      ]
    }
  )
  const orphaned = buildCatalog([], {
    previousMetadata: meta(first),
    explicitMessages: [
      { key: 'items.deleted', source: '已删除 {count} 项' }
    ]
  })
  assert.strictEqual(orphaned.entries['items.deleted'].status, 'orphaned')
  assert.strictEqual(orphaned.messages['items.deleted'], undefined)

  const recovered = buildCatalog(
    [snapshot('src/b.js::script', [
      callEntry('items.deleted', at('src/b.js', 'script-string', 2, 0, 24), {
        paramNames: ['count'],
        paramsKind: 'static'
      })
    ])],
    {
      previousMetadata: meta(orphaned),
      explicitMessages: [
        { key: 'items.deleted', source: '已删除 {count} 项' }
      ]
    }
  )
  assert.strictEqual(recovered.entries['items.deleted'].status, 'active')
  assert.strictEqual(recovered.messages['items.deleted'], '已删除 {count} 项')
  assert.deepStrictEqual(recovered.orphaned, [])
})

test('structured explicit messages use named slot placeholders and shared keys keep one contract', () => {
  const first = at('src/a.vue', 'script-string', 1, 0, 40)
  const second = at('src/b.vue', 'script-string', 2, 0, 40)
  const catalog = buildCatalog(
    [
      snapshot('src/a.vue::script', [
        callEntry('terms.notice', first, {
          paramNames: ['terms', 'privacy'],
          paramsKind: 'static'
        })
      ]),
      snapshot('src/b.vue::script', [
        callEntry('terms.notice', second, {
          paramNames: ['terms', 'privacy'],
          paramsKind: 'static'
        })
      ])
    ],
    {
      explicitMessages: [
        { key: 'terms.notice', source: '请阅读我们的{terms}与{privacy}' }
      ]
    }
  )
  assert.deepStrictEqual(catalog.referenceErrors, [])
  assert.deepStrictEqual(catalog.conflicts, [])
  assert.strictEqual(catalog.messages['terms.notice'], '请阅读我们的{terms}与{privacy}')
  assert.strictEqual(catalog.entries['terms.notice'].origin, 'explicit')
  assert.deepStrictEqual(
    catalog.entries['terms.notice'].locations.map(item => item.path).sort(),
    ['src/a.vue', 'src/b.vue']
  )
})

test('structured explicit messages reject incompatible slot contracts', () => {
  const location = at('src/a.vue', 'script-string', 1, 0, 40)
  const mismatchedCall = buildCatalog(
    [snapshot('src/a.vue::script', [
      callEntry('terms.notice', location, {
        paramNames: ['link', 'policy'],
        paramsKind: 'static'
      })
    ])],
    {
      explicitMessages: [
        { key: 'terms.notice', source: '请阅读我们的{terms}与{privacy}' }
      ]
    }
  )
  assert.ok(mismatchedCall.referenceErrors.some(item => (
    item.key === 'terms.notice' && item.reason === 'placeholder-mismatch'
  )))
  assert.strictEqual(mismatchedCall.messages['terms.notice'], undefined)

  const first = at('src/a.js', 'script-string', 1, 0, 20)
  const second = at('src/b.js', 'script-string', 2, 0, 20)
  const conflicted = buildCatalog([
    snapshot('src/a.js::script', [
      { value: '请阅读我们的{terms}与{privacy}', key: 'terms.notice', locations: [first] }
    ]),
    snapshot('src/b.js::script', [
      { value: '请阅读我们的{privacy}与{terms}', key: 'terms.notice', locations: [second] }
    ])
  ])
  assert.ok(conflicted.conflicts.some(item => item.key === 'terms.notice'))
  assert.strictEqual(conflicted.messages['terms.notice'], undefined)
})

test('existing parameterless localized calls stay compatible beside explicit messages', () => {
  const sourceLocation = at('src/a.js', 'script-string', 1, 0, 4)
  const first = buildCatalog([
    snapshot('src/a.js::script', [{ value: '你好', locations: [sourceLocation] }])
  ])
  const [autoKey] = Object.keys(first.messages)
  const catalog = buildCatalog(
    [snapshot('src/a.js::script', [
      callEntry(autoKey, at('src/a.js', 'script-string', 4, 0, 10)),
      callEntry('items.deleted', at('src/a.js', 'script-string', 5, 0, 24), {
        paramNames: ['count'],
        paramsKind: 'static'
      })
    ])],
    {
      previousMetadata: meta(first),
      explicitMessages: [
        { key: 'items.deleted', source: '已删除 {count} 项' }
      ]
    }
  )
  assert.deepStrictEqual(catalog.referenceErrors, [])
  assert.strictEqual(catalog.messages[autoKey], '你好')
  assert.strictEqual(catalog.messages['items.deleted'], '已删除 {count} 项')
})
