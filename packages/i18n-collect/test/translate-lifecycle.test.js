const assert = require('assert')
const test = require('node:test')
const { fingerprintOf } = require('../mycommon/catalog')
const { planTranslation, serializeState } = require('../mycommon/translate')

test('planTranslation requests drafts only for missing target keys', () => {
  const plan = planTranslation({
    entries: {
      'home.keep': { source: '保留', fingerprint: fingerprintOf('保留') },
      'home.title': { source: '首页', fingerprint: fingerprintOf('首页') }
    },
    targets: { en: { 'home.keep': 'Keep' } },
    state: { version: 1, locales: {} },
    locales: ['en']
  })
  assert.deepStrictEqual(plan.items, [
    { key: 'home.title', source: '首页', locales: ['en'] }
  ])
  assert.deepStrictEqual(plan.pending, [
    { key: 'home.title', locale: 'en', fingerprint: fingerprintOf('首页'), replace: false }
  ])
  assert.deepStrictEqual(plan.kept, [{ key: 'home.keep', locale: 'en' }])
  assert.deepStrictEqual(plan.stale, [])
  assert.deepStrictEqual(plan.pruned, [])
})

test('planTranslation reports stale target keys without removing them by default', () => {
  const live = fingerprintOf('在线')
  const gone = fingerprintOf('旧文案')
  const plan = planTranslation({
    entries: {
      'home.live': { source: '在线', fingerprint: live }
    },
    targets: {
      en: {
        'home.live': 'Live',
        'home.stale': 'Stale'
      }
    },
    state: {
      version: 1,
      locales: {
        en: {
          'home.live': { sourceFingerprint: live, review: 'current' },
          'home.stale': { sourceFingerprint: gone, review: 'current' }
        }
      }
    },
    locales: ['en']
  })
  assert.deepStrictEqual(plan.nextTargets.en, {
    'home.live': 'Live',
    'home.stale': 'Stale'
  })
  assert.deepStrictEqual(plan.nextState.locales.en['home.stale'], {
    sourceFingerprint: gone,
    review: 'current'
  })
  assert.deepStrictEqual(plan.stale, [{ key: 'home.stale', locale: 'en' }])
  assert.deepStrictEqual(plan.pruned, [])
})

test('planTranslation prune removes stale target entries and review state', () => {
  const live = fingerprintOf('在线')
  const gone = fingerprintOf('旧文案')
  const plan = planTranslation({
    entries: {
      'home.live': { source: '在线', fingerprint: live }
    },
    targets: {
      en: {
        'home.live': 'Live',
        'home.stale': 'Stale'
      }
    },
    state: {
      version: 1,
      locales: {
        en: {
          'home.live': { sourceFingerprint: live, review: 'current' },
          'home.stale': { sourceFingerprint: gone, review: 'current' }
        }
      }
    },
    locales: ['en'],
    prune: true
  })
  assert.deepStrictEqual(plan.nextTargets.en, { 'home.live': 'Live' })
  assert.strictEqual(plan.nextState.locales.en['home.stale'], undefined)
  assert.deepStrictEqual(plan.stale, [{ key: 'home.stale', locale: 'en' }])
  assert.deepStrictEqual(plan.pruned, [{ key: 'home.stale', locale: 'en' }])
  const serialized = JSON.parse(serializeState(plan.nextState))
  assert.strictEqual(serialized.locales.en['home.stale'], undefined)
})

test('an explicit source fingerprint change keeps the translation and marks needs-review', () => {
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
  assert.deepStrictEqual(plan.items, [])
})

test('a changed automatic source text is a new key and a normal missing translation', () => {
  const oldKey = `auto.${fingerprintOf('旧问候')}`
  const newKey = `auto.${fingerprintOf('新问候')}`
  const plan = planTranslation({
    entries: {
      [newKey]: { source: '新问候', fingerprint: fingerprintOf('新问候') }
    },
    targets: {
      en: { [oldKey]: 'Old greeting' }
    },
    state: {
      version: 1,
      locales: {
        en: {
          [oldKey]: { sourceFingerprint: fingerprintOf('旧问候'), review: 'current' }
        }
      }
    },
    locales: ['en']
  })
  assert.deepStrictEqual(plan.pending, [
    { key: newKey, locale: 'en', fingerprint: fingerprintOf('新问候'), replace: false }
  ])
  assert.deepStrictEqual(plan.stale, [{ key: oldKey, locale: 'en' }])
  assert.strictEqual(plan.nextTargets.en[oldKey], 'Old greeting')
  assert.deepStrictEqual(plan.pruned, [])
})
